import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
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
import { SyncAccountsUseCase } from '../application/sync-accounts.use-case.js';
import { SyncOrdersUseCase } from '../application/sync-orders.use-case.js';
import { MapperRegistry } from '../infrastructure/adapters/mapper-registry.js';
import { NetsuiteAdapter, NetsuiteConfig } from '../infrastructure/adapters/netsuite/netsuite.adapter.js';
import { ZohoAdapter, ZohoConfig } from '../infrastructure/adapters/zoho/zoho.adapter.js';
import { DynamicZohoMapper, FieldMappingsConfig } from '../infrastructure/adapters/zoho/mappers/dynamic.mapper.js';
import { AccountRepository } from '../infrastructure/repositories/account.repository.js';
import { OrderRepository } from '../infrastructure/repositories/order.repository.js';
import { SyncStatusRepository } from '../infrastructure/repositories/sync-status.repository.js';
import { OrderChangeRepository } from '../infrastructure/repositories/order-change.repository.js';
import { parseConnectionData } from '../infrastructure/credential-decrypt.util.js';

interface TenantMetadata {
  connectionType?: 'netsuite' | 'zoho';
}

@Injectable()
export class SyncScheduler implements OnModuleInit {
  private readonly logger = new Logger(SyncScheduler.name);

  constructor(
    private readonly syncAccountsUseCase: SyncAccountsUseCase,
    private readonly syncOrdersUseCase: SyncOrdersUseCase,
    private readonly mapperRegistry: MapperRegistry,
    private readonly netsuiteAdapter: NetsuiteAdapter,
    private readonly zohoAdapter: ZohoAdapter,
  ) {}

  onModuleInit() {
    this.logger.log('Sync scheduler initialized');
  }

  /**
   * Run sync every 10 minutes
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleSync() {
    this.logger.log('Starting scheduled sync for all tenants...');

    try {
      const syncEnabledTenants = await this.getSyncEnabledTenants();
      this.logger.log(`Found ${syncEnabledTenants.length} tenants with sync enabled`);

      for (const tenant of syncEnabledTenants) {
        try {
          await this.syncTenant(tenant);
        } catch (error) {
          this.logger.error(`Failed to sync tenant ${tenant.slug}: ${error}`);
        }
      }

      this.logger.log('Scheduled sync complete');
    } catch (error) {
      this.logger.error(`Scheduled sync failed: ${error}`);
    }
  }

  /**
   * Get all tenants with sync enabled from the landlord database, joined
   * with their domain rows for the tenant DB connection info — the same
   * source of truth the DEP push/poll schedulers use. (Previously this
   * guessed the DB name from a `tenant_<slug>` naming convention, which
   * can silently connect to the wrong/unmigrated database.)
   */
  private async getSyncEnabledTenants() {
    const rows = await getLandlordDb()
      .select({
        tenantId: tenants.id,
        slug: tenants.slug,
        metadata: tenants.metadata,
        dbHost: domains.dbHost,
        dbPort: domains.dbPort,
        dbName: domains.dbName,
        dbUser: domains.dbUser,
        dbPassword: domains.dbPassword,
        isPrimary: domains.isPrimary,
      })
      .from(tenants)
      .innerJoin(domains, eq(tenants.id, domains.tenantId))
      .where(
        and(
          eq(tenants.isActive, true),
          eq(tenants.syncEnabled, true)
        )
      );

    // Dedupe by tenant (pick primary domain)
    const byTenant = new Map<string, typeof rows[0]>();
    for (const row of rows) {
      if (!byTenant.has(row.tenantId) || row.isPrimary) {
        byTenant.set(row.tenantId, row);
      }
    }

    return [...byTenant.values()];
  }

  /**
   * Sync a single tenant
   */
  private async syncTenant(tenant: {
    slug: string;
    metadata: string | null;
    dbHost: string;
    dbPort: number;
    dbName: string;
    dbUser: string;
    dbPassword: string;
  }) {
    this.logger.log(`Syncing tenant: ${tenant.slug}`);

    // Parse tenant metadata for connection type
    const metadata: TenantMetadata = tenant.metadata
      ? JSON.parse(tenant.metadata)
      : {};
    const connectionType = metadata.connectionType || 'netsuite';

    // Connect to tenant database using the connection info from the
    // domains table
    const connection = await mysql.createConnection({
      host: tenant.dbHost,
      port: tenant.dbPort,
      user: tenant.dbUser,
      password: tenant.dbPassword,
      database: tenant.dbName,
    });
    const tenantDb = drizzle(connection) as unknown as TenantDb;

    try {
      // Get credentials for the connection type
      const credential = await this.getCredential(tenantDb, connectionType);
      if (!credential) {
        this.logger.warn(`No ${connectionType} credentials for tenant ${tenant.slug}`);
        return;
      }

      // Configure adapter and get mapper
      const { adapter, mapper } = await this.configureAdapter(
        connectionType,
        credential.connectionData
      );

      if (!adapter || !mapper) {
        this.logger.error(`Failed to configure adapter for tenant ${tenant.slug}`);
        return;
      }

      // Fresh repository instances per run: the repositories are NOT the
      // NestJS singletons because the DEP push/poll schedulers run
      // concurrently and would re-point a shared repository at their own
      // (soon-closed) connection mid-sync.
      const accountRepository = new AccountRepository();
      const orderRepository = new OrderRepository();
      const syncStatusRepository = new SyncStatusRepository();
      const orderChangeRepository = new OrderChangeRepository();
      accountRepository.setDb(tenantDb);
      orderRepository.setDb(tenantDb);
      syncStatusRepository.setDb(tenantDb);
      orderChangeRepository.setDb(tenantDb);

      // Wire up change tracking
      orderRepository.setChangeRepository(orderChangeRepository);

      // Get last successful sync time for incremental sync
      const lastAccountSyncAt = await syncStatusRepository.getLastSuccessAt('accounts');
      const lastOrderSyncAt = await syncStatusRepository.getLastSuccessAt('orders');

      // A full-history orders pull takes NetSuite longer than fetch's
      // 5-minute headers timeout. Bound the first-ever window; anything
      // older comes in via the historical import tool.
      const initialOrdersWindow = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const ordersSince = lastOrderSyncAt ?? initialOrdersWindow;
      if (!lastOrderSyncAt) {
        this.logger.log(
          `No successful orders sync yet for ${tenant.slug} — starting from ${ordersSince.toISOString().split('T')[0]}`,
        );
      }

      // Sync accounts
      this.logger.log(`Syncing accounts for tenant ${tenant.slug}...`);
      await this.syncAccountsUseCase.execute(
        adapter,
        mapper,
        accountRepository,
        syncStatusRepository,
        { lastModified: lastAccountSyncAt ?? undefined }
      );

      // Sync orders
      this.logger.log(`Syncing orders for tenant ${tenant.slug}...`);
      await this.syncOrdersUseCase.execute(
        adapter,
        mapper,
        accountRepository,
        orderRepository,
        syncStatusRepository,
        { lastModified: ordersSince }
      );

      this.logger.log(`Tenant ${tenant.slug} sync complete`);
    } finally {
      await connection.end();
    }
  }

  private async getCredential(db: TenantDb, type: string) {
    const results = await db
      .select()
      .from(credentials)
      .where(and(eq(credentials.type, type as never), eq(credentials.status, 'current')))
      .limit(1);

    if (results.length === 0) return null;

    return {
      ...results[0],
      connectionData: parseConnectionData(results[0].connectionData),
    };
  }

  private async configureAdapter(
    connectionType: 'netsuite' | 'zoho',
    connectionData: Record<string, unknown>
  ) {
    if (connectionType === 'netsuite') {
      const config: NetsuiteConfig = {
        authType: (connectionData['auth_type'] as 'oauth1' | 'oauth2') || 'oauth1',
        restletHost: connectionData['netsuite_restlet_host'] as string,
        account: connectionData['netsuite_account'] as string,
        deployId: connectionData['netsuite_deploy_id'] as number,
        orderScriptId: connectionData['netsuite_order_script_id'] as string,
        accountScriptId: connectionData['netsuite_account_script_id'] as string,
        clientId: connectionData['client_id'] as string,
        certificateId: connectionData['certificate_id'] as string,
        privateKey: connectionData['private_key'] as string,
        consumerKey: connectionData['netsuite_consumer_key'] as string,
        consumerSecret: connectionData['netsuite_consumer_secret'] as string,
        token: connectionData['netsuite_token'] as string,
        tokenSecret: connectionData['netsuite_token_secret'] as string,
        realm: connectionData['netsuite_realm'] as string,
      };
      this.netsuiteAdapter.configure(config);

      const mappingClass = connectionData['mapping_class'] as string || 'netsuite-default';
      const mapper = await this.mapperRegistry.getMapper(mappingClass);

      return { adapter: this.netsuiteAdapter, mapper };
    } else {
      const config: ZohoConfig = {
        clientId: connectionData['client_id'] as string,
        clientSecret: connectionData['client_secret'] as string,
        refreshToken: connectionData['refresh_token'] as string,
        apiDomain: connectionData['api_domain'] as string || 'https://www.zohoapis.com',
        accountsModule: connectionData['accounts_module'] as string || 'Accounts',
        ordersModule: connectionData['orders_module'] as string || 'Sales_Orders',
      };
      this.zohoAdapter.configure(config);

      // Use dynamic mapper when tenant provides field_mappings config,
      // otherwise fall back to class-based mapper from registry
      const fieldMappings = connectionData['field_mappings'] as FieldMappingsConfig | undefined;
      let mapper;

      if (fieldMappings) {
        mapper = new DynamicZohoMapper(fieldMappings);
        this.logger.log('Using dynamic Zoho mapper with custom field mappings');
      } else {
        const mappingClass = connectionData['mapping_class'] as string || 'zoho-default';
        mapper = await this.mapperRegistry.getMapper(mappingClass);
      }

      return { adapter: this.zohoAdapter, mapper };
    }
  }
}

