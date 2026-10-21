import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { drizzle } from 'drizzle-orm/mysql2';
import * as mysql from 'mysql2/promise';
import { eq, and } from 'drizzle-orm';
import { getLandlordDb, tenants, domains, credentials, TenantDb } from '@org/database';
import { ZohoAdapter } from '../infrastructure/adapters/zoho/zoho.adapter.js';
import { DepSyncAdapter, DepAdapterConfig } from '../infrastructure/adapters/dep/dep-sync.adapter.js';
import {
  DynamicZohoMapper,
  FieldMappingsConfig,
} from '../infrastructure/adapters/zoho/mappers/dynamic.mapper.js';
import { MapperRegistry } from '../infrastructure/adapters/mapper-registry.js';
import { OrderRepository } from '../infrastructure/repositories/order.repository.js';
import { ReconciliationRepository } from '../infrastructure/repositories/reconciliation.repository.js';
import { ReconcileRunUseCase } from '../application/reconcile-run.use-case.js';
import { parseConnectionData } from '../infrastructure/credential-decrypt.util.js';

/**
 * Drives reconciliation runs. Each tick, for any tenant with an active
 * (pending/running) run, processes that run to completion against Zoho + Apple
 * DEP, checkpointing a durable cursor. A crash/redeploy mid-run is resumed on
 * the next tick from the cursor. A module-level guard prevents overlapping
 * ticks (a long run would otherwise be re-entered).
 */
@Injectable()
export class ReconciliationScheduler {
  private readonly logger = new Logger(ReconciliationScheduler.name);
  private busy = false;

  constructor(
    private readonly mapperRegistry: MapperRegistry,
    private readonly reconcileRunUseCase: ReconcileRunUseCase,
  ) {}

  @Cron('0 */2 * * * *')
  async handleTick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const landlordDb = getLandlordDb();
      const tenantRows = await landlordDb
        .select({
          tenantId: tenants.id,
          slug: tenants.slug,
          dbHost: domains.dbHost,
          dbPort: domains.dbPort,
          dbName: domains.dbName,
          dbUser: domains.dbUser,
          dbPassword: domains.dbPassword,
          isPrimary: domains.isPrimary,
        })
        .from(tenants)
        .innerJoin(domains, eq(tenants.id, domains.tenantId))
        .where(eq(tenants.isActive, true));

      const tenantMap = new Map<string, (typeof tenantRows)[0]>();
      for (const row of tenantRows) {
        if (!tenantMap.has(row.tenantId) || row.isPrimary) tenantMap.set(row.tenantId, row);
      }

      for (const [, tenant] of tenantMap) {
        try {
          await this.runForTenant(tenant);
        } catch (error) {
          this.logger.error(`Reconciliation failed for tenant ${tenant.slug}: ${error}`);
        }
      }
    } catch (error) {
      this.logger.error(`Reconciliation tick failed: ${error}`);
    } finally {
      this.busy = false;
    }
  }

  private async runForTenant(tenant: {
    slug: string;
    dbHost: string;
    dbPort: number;
    dbName: string;
    dbUser: string;
    dbPassword: string;
  }): Promise<void> {
    const connection = await mysql.createConnection({
      host: tenant.dbHost,
      port: tenant.dbPort,
      user: tenant.dbUser,
      password: tenant.dbPassword,
      database: tenant.dbName,
    });

    try {
      const tenantDb = drizzle(connection) as unknown as TenantDb;

      const reconRepo = new ReconciliationRepository();
      reconRepo.setDb(tenantDb);

      // Short-circuit before any credential read / external call.
      const run = await reconRepo.findActiveRun();
      if (!run) return;

      this.logger.log(`Reconciliation run ${run.runId} picked up for ${tenant.slug}`);

      const zoho = await this.buildZohoAdapter(tenantDb);
      if (!zoho) {
        await reconRepo.fail(run.id, 'No active Zoho credentials configured');
        return;
      }
      if (!zoho.mapper) {
        await reconRepo.fail(run.id, 'Zoho mapper not found for this tenant');
        return;
      }
      const depAdapter = await this.buildDepAdapter(tenantDb);
      if (!depAdapter) {
        await reconRepo.fail(run.id, 'No active DEP credentials configured');
        return;
      }

      // Corrections must stay silent (no change repository) so they never emit
      // order_changes / trigger the downstream auto-push / OV path.
      const orderRepo = new OrderRepository();
      orderRepo.setDb(tenantDb);

      await this.reconcileRunUseCase.processRun({
        run,
        reconRepo,
        orderRepo,
        zohoAdapter: zoho.adapter,
        mapper: zoho.mapper,
        depAdapter,
      });
    } finally {
      await connection.end();
    }
  }

  private async buildZohoAdapter(db: TenantDb) {
    const rows = await db
      .select()
      .from(credentials)
      .where(and(eq(credentials.type, 'zoho'), eq(credentials.status, 'current')))
      .limit(1);
    if (rows.length === 0) return null;

    const data = parseConnectionData(rows[0].connectionData);
    const fieldMappings = data['field_mappings'] as FieldMappingsConfig | undefined;

    const adapter = new ZohoAdapter();
    adapter.configure({
      clientId: data['client_id'] as string,
      clientSecret: data['client_secret'] as string,
      refreshToken: data['refresh_token'] as string,
      apiDomain: (data['api_domain'] as string) || 'https://www.zohoapis.com',
      accountsModule: (data['accounts_module'] as string) || 'Accounts',
      ordersModule: (data['orders_module'] as string) || 'Sales_Orders',
      fieldMappings,
    });

    const mapper = fieldMappings
      ? new DynamicZohoMapper(fieldMappings)
      : await this.mapperRegistry.getMapper((data['mapping_class'] as string) || 'zoho-default');

    return { adapter, mapper };
  }

  private async buildDepAdapter(db: TenantDb): Promise<DepSyncAdapter | null> {
    const rows = await db
      .select()
      .from(credentials)
      .where(and(eq(credentials.type, 'dep'), eq(credentials.status, 'current')))
      .limit(1);
    if (rows.length === 0) return null;

    const data = parseConnectionData(rows[0].connectionData);
    const config: DepAdapterConfig = {
      apiUrl: data['apple_api_url'] as string,
      shipTo: data['sap_ship_to'] as string,
      depResellerId: data['dep_reseller_id'] as string,
      sslKey: data['ssl_key'] as string,
      sslCert: data['ssl_cert'] as string,
    };
    const adapter = new DepSyncAdapter();
    adapter.configure(config);
    return adapter;
  }
}
