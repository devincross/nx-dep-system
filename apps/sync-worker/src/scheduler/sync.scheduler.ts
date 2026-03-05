import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { drizzle } from 'drizzle-orm/mysql2';
import * as mysql from 'mysql2/promise';
import { eq, and, isNull } from 'drizzle-orm';
import {
  landlordDb,
  tenants,
  tenantDomains,
  credentials,
  TenantDb,
} from '@org/database';
import { SyncAccountsUseCase } from '../application/sync-accounts.use-case.js';
import { SyncOrdersUseCase } from '../application/sync-orders.use-case.js';
import { MapperRegistry } from '../infrastructure/adapters/mapper-registry.js';
import { NetsuiteAdapter, NetsuiteConfig } from '../infrastructure/adapters/netsuite/netsuite.adapter.js';
import { ZohoAdapter, ZohoConfig } from '../infrastructure/adapters/zoho/zoho.adapter.js';
import { AccountRepository } from '../infrastructure/repositories/account.repository.js';
import { OrderRepository } from '../infrastructure/repositories/order.repository.js';
import { SyncStatusRepository } from '../infrastructure/repositories/sync-status.repository.js';

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
    private readonly accountRepository: AccountRepository,
    private readonly orderRepository: OrderRepository,
    private readonly syncStatusRepository: SyncStatusRepository,
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
      const activeTenants = await this.getActiveTenants();
      this.logger.log(`Found ${activeTenants.length} active tenants`);

      for (const tenant of activeTenants) {
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
   * Get all active tenants from landlord database
   */
  private async getActiveTenants() {
    const results = await landlordDb
      .select()
      .from(tenants)
      .where(and(eq(tenants.isActive, true), isNull(tenants.deletedAt)));

    return results;
  }

  /**
   * Sync a single tenant
   */
  private async syncTenant(tenant: typeof tenants.$inferSelect) {
    this.logger.log(`Syncing tenant: ${tenant.slug}`);

    // Parse tenant metadata for connection type
    const metadata: TenantMetadata = tenant.metadata
      ? JSON.parse(tenant.metadata)
      : {};
    const connectionType = metadata.connectionType || 'netsuite';

    // Connect to tenant database
    const tenantDb = await this.connectToTenantDb(tenant.slug);
    if (!tenantDb) {
      this.logger.error(`Failed to connect to tenant database: ${tenant.slug}`);
      return;
    }

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

      // Set database connection on repositories
      this.accountRepository.setDb(tenantDb);
      this.orderRepository.setDb(tenantDb);
      this.syncStatusRepository.setDb(tenantDb);

      // Get last sync time for incremental sync
      const lastAccountSync = await this.syncStatusRepository.getLatest('accounts');
      const lastOrderSync = await this.syncStatusRepository.getLatest('orders');

      // Sync accounts
      this.logger.log(`Syncing accounts for tenant ${tenant.slug}...`);
      await this.syncAccountsUseCase.execute(
        adapter,
        mapper,
        this.accountRepository,
        this.syncStatusRepository,
        { lastModified: lastAccountSync?.lastSuccessAt }
      );

      // Sync orders
      this.logger.log(`Syncing orders for tenant ${tenant.slug}...`);
      await this.syncOrdersUseCase.execute(
        adapter,
        mapper,
        this.accountRepository,
        this.orderRepository,
        this.syncStatusRepository,
        { lastModified: lastOrderSync?.lastSuccessAt }
      );

      this.logger.log(`Tenant ${tenant.slug} sync complete`);
    } finally {
      // Close tenant database connection
      // Note: In production, you might want to pool these connections
    }
  }

  private async connectToTenantDb(slug: string): Promise<TenantDb | null> {
    try {
      const dbName = `tenant_${slug.replace(/-/g, '_')}`;
      const connection = await mysql.createConnection({
        host: process.env['DB_HOST'] || 'localhost',
        port: parseInt(process.env['DB_PORT'] || '3306'),
        user: process.env['DB_USER'] || 'root',
        password: process.env['DB_PASSWORD'] || '',
        database: dbName,
      });
      return drizzle(connection) as TenantDb;
    } catch (error) {
      this.logger.error(`Failed to connect to tenant DB: ${error}`);
      return null;
    }
  }

  private async getCredential(db: TenantDb, type: string) {
    const results = await db
      .select()
      .from(credentials)
      .where(and(eq(credentials.type, type as never), eq(credentials.status, 'current')))
      .limit(1);

    if (results.length === 0) return null;

    // Note: connectionData needs decryption in real implementation
    return {
      ...results[0],
      connectionData: JSON.parse(results[0].connectionData) as Record<string, unknown>,
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

      const mappingClass = connectionData['mapping_class'] as string || 'zoho-default';
      const mapper = await this.mapperRegistry.getMapper(mappingClass);

      return { adapter: this.zohoAdapter, mapper };
    }
  }
}

