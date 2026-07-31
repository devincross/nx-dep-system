import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { drizzle } from 'drizzle-orm/mysql2';
import * as mysql from 'mysql2/promise';
import { eq, and } from 'drizzle-orm';
import {
  getLandlordDb,
  tenants,
  domains,
  credentials,
  TenantDb,
} from '@org/database';
import { DepPushChangesUseCase } from '../application/dep-push-changes.use-case.js';
import { DepSyncAdapter, DepAdapterConfig } from '../infrastructure/adapters/dep/dep-sync.adapter.js';
import { DepTransactionRepository } from '../infrastructure/repositories/dep-transaction.repository.js';
import { OrderRepository } from '../infrastructure/repositories/order.repository.js';
import { OrderChangeRepository } from '../infrastructure/repositories/order-change.repository.js';
import { parseConnectionData } from '../infrastructure/credential-decrypt.util.js';
import { AccountRepository } from '../infrastructure/repositories/account.repository.js';

@Injectable()
export class DepPushScheduler {
  private readonly logger = new Logger(DepPushScheduler.name);

  constructor(
    private readonly depPushUseCase: DepPushChangesUseCase,
    private readonly depAdapter: DepSyncAdapter,
    private readonly depTransactionRepo: DepTransactionRepository,
    private readonly orderRepository: OrderRepository,
    private readonly orderChangeRepository: OrderChangeRepository,
    private readonly accountRepository: AccountRepository,
  ) {}

  /**
   * Push DEP changes every 10 minutes (runs after the sync scheduler).
   * Uses EVERY_10_MINUTES offset by 5 minutes to stagger from the main sync.
   */
  @Cron('5 */10 * * * *')
  async handleDepPush() {
    this.logger.log('Starting DEP push for all tenants...');

    try {
      const landlordDb = getLandlordDb();

      const tenantRows = await landlordDb
        .select({
          tenantId: tenants.id,
          slug: tenants.slug,
          syncEnabled: tenants.syncEnabled,
          dbHost: domains.dbHost,
          dbPort: domains.dbPort,
          dbName: domains.dbName,
          dbUser: domains.dbUser,
          dbPassword: domains.dbPassword,
          isPrimary: domains.isPrimary,
        })
        .from(tenants)
        .innerJoin(domains, eq(tenants.id, domains.tenantId))
        .where(and(eq(tenants.isActive, true), eq(tenants.syncEnabled, true)));

      // Dedupe by tenant
      const tenantMap = new Map<string, typeof tenantRows[0]>();
      for (const row of tenantRows) {
        if (!tenantMap.has(row.tenantId) || row.isPrimary) {
          tenantMap.set(row.tenantId, row);
        }
      }

      for (const [, tenant] of tenantMap) {
        try {
          await this.pushForTenant(tenant);
        } catch (error) {
          this.logger.error(`DEP push failed for tenant ${tenant.slug}: ${error}`);
        }
      }

      this.logger.log('DEP push cycle complete');
    } catch (error) {
      this.logger.error(`DEP push scheduler failed: ${error}`);
    }
  }

  private async pushForTenant(tenant: {
    slug: string;
    dbHost: string;
    dbPort: number;
    dbName: string;
    dbUser: string;
    dbPassword: string;
  }) {
    const connection = await mysql.createConnection({
      host: tenant.dbHost,
      port: tenant.dbPort,
      user: tenant.dbUser,
      password: tenant.dbPassword,
      database: tenant.dbName,
    });

    try {
      const tenantDb = drizzle(connection) as unknown as TenantDb;

      // Get DEP credentials
      const depCred = await this.getDepCredentials(tenantDb);
      if (!depCred) return; // No DEP credentials — skip silently

      // Configure adapter and repos
      this.depAdapter.configure(depCred);
      this.depTransactionRepo.setDb(tenantDb);
      this.orderRepository.setDb(tenantDb);
      this.orderChangeRepository.setDb(tenantDb);
      this.accountRepository.setDb(tenantDb);
      this.orderRepository.setChangeRepository(this.orderChangeRepository);

      const result = await this.depPushUseCase.execute(
        this.orderChangeRepository,
        this.orderRepository,
        this.depAdapter,
        this.depTransactionRepo,
        this.accountRepository,
      );

      if (result.submitted > 0 || result.failed > 0) {
        this.logger.log(
          `DEP push for ${tenant.slug}: ${result.submitted} submitted, ${result.failed} failed, ${result.skipped} skipped`,
        );
      }
    } finally {
      await connection.end();
    }
  }

  private async getDepCredentials(
    db: TenantDb,
  ): Promise<DepAdapterConfig | null> {
    const results = await db
      .select()
      .from(credentials)
      .where(and(eq(credentials.type, 'dep'), eq(credentials.status, 'current')))
      .limit(1);

    if (results.length === 0) return null;

    let data: Record<string, unknown>;
    try {
      data = parseConnectionData(results[0].connectionData);
    } catch (error) {
      this.logger.error(`Failed to parse DEP credentials: ${error}`);
      return null;
    }

    const apiUrl = data['apple_api_url'] as string;
    const shipTo = data['sap_ship_to'] as string;
    const depResellerId = data['dep_reseller_id'] as string;
    const sslKey = data['ssl_key'] as string;
    const sslCert = data['ssl_cert'] as string;

    if (!apiUrl || !shipTo || !depResellerId || !sslKey || !sslCert) return null;

    return { apiUrl, shipTo, depResellerId, sslKey, sslCert };
  }
}
