import { Injectable, Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/mysql2';
import * as mysql from 'mysql2/promise';
import { eq, and } from 'drizzle-orm';
import {
  getLandlordDb,
  tenants,
  TenantDb,
} from '@org/database';
import { PushChangesUseCase } from '../application/push-changes.use-case.js';
import { OrderRepository } from '../infrastructure/repositories/order.repository.js';
import { OrderChangeRepository } from '../infrastructure/repositories/order-change.repository.js';
import { DownstreamSyncAdapter, DownstreamConfig } from '../infrastructure/adapters/downstream/downstream-sync.adapter.js';
import {
  PushChangesRequestDto,
  PushChangesResponseDto,
  TenantPushResult,
  PendingChangesResponseDto,
} from './dto/push-changes.dto.js';

interface TenantRecord {
  id: string;
  slug: string;
}

@Injectable()
export class PushChangesService {
  private readonly logger = new Logger(PushChangesService.name);
  private downstreamConfig: DownstreamConfig | null = null;

  constructor(
    private readonly pushChangesUseCase: PushChangesUseCase,
    private readonly orderRepository: OrderRepository,
    private readonly orderChangeRepository: OrderChangeRepository,
    private readonly downstreamAdapter: DownstreamSyncAdapter,
  ) {}

  /**
   * Configure the downstream system
   */
  configureDownstream(config: DownstreamConfig): void {
    this.downstreamConfig = config;
    this.downstreamAdapter.configure(config);
    this.logger.log(`Downstream configured: ${config.baseUrl}`);
  }

  /**
   * Push changes for one or all tenants
   */
  async pushChanges(request: PushChangesRequestDto): Promise<PushChangesResponseDto> {
    const startTime = new Date();
    const results: TenantPushResult[] = [];
    
    if (!this.downstreamConfig) {
      throw new Error('Downstream system not configured. Call configureDownstream() first or provide config in request.');
    }

    // Get tenants to process
    const tenantsToProcess = request.tenantSlug
      ? await this.getTenantBySlug(request.tenantSlug)
      : await this.getSyncEnabledTenants();

    if (tenantsToProcess.length === 0) {
      return {
        success: true,
        message: 'No tenants to process',
        timestamp: startTime.toISOString(),
        tenantsProcessed: 0,
        results: [],
        summary: {
          totalOrdersProcessed: 0,
          totalSuccessful: 0,
          totalFailed: 0,
          totalOrderChangesSynced: 0,
          totalItemChangesSynced: 0,
        },
      };
    }

    this.logger.log(`Processing ${tenantsToProcess.length} tenant(s)`);

    // Process each tenant
    for (const tenant of tenantsToProcess) {
      const result = await this.pushChangesForTenant(tenant, request);
      results.push(result);
    }

    // Calculate summary
    const summary = {
      totalOrdersProcessed: results.reduce((sum, r) => sum + r.totalOrders, 0),
      totalSuccessful: results.reduce((sum, r) => sum + r.successCount, 0),
      totalFailed: results.reduce((sum, r) => sum + r.failedCount, 0),
      totalOrderChangesSynced: results.reduce((sum, r) => sum + r.orderChangesSynced, 0),
      totalItemChangesSynced: results.reduce((sum, r) => sum + r.itemChangesSynced, 0),
    };

    const allSuccessful = results.every(r => r.success);

    return {
      success: allSuccessful,
      message: allSuccessful
        ? `Successfully pushed changes for ${results.length} tenant(s)`
        : `Completed with some failures. Check results for details.`,
      timestamp: startTime.toISOString(),
      tenantsProcessed: results.length,
      results,
      summary,
    };
  }

  /**
   * Get pending changes for a tenant
   */
  async getPendingChanges(tenantSlug: string): Promise<PendingChangesResponseDto> {
    const tenantList = await this.getTenantBySlug(tenantSlug);
    
    if (tenantList.length === 0) {
      throw new Error(`Tenant not found: ${tenantSlug}`);
    }

    const tenant = tenantList[0];
    const tenantDb = await this.createTenantConnection(tenant);

    try {
      this.orderChangeRepository.setDb(tenantDb);
      const changes = await this.orderChangeRepository.findUnsyncedChanges();

      // Find oldest change
      const allChanges = [
        ...changes.orderChanges.map(c => c.createdAt),
        ...changes.itemChanges.map(c => c.createdAt),
      ].filter(Boolean) as Date[];
      
      const oldestChange = allChanges.length > 0
        ? new Date(Math.min(...allChanges.map(d => d.getTime())))
        : undefined;

      return {
        tenantSlug,
        pendingOrderChanges: changes.orderChanges.length,
        pendingItemChanges: changes.itemChanges.length,
        oldestChangeAt: oldestChange?.toISOString(),
      };
    } finally {
      // Connection cleanup would go here if needed
    }
  }

  private async pushChangesForTenant(
    tenant: TenantRecord,
    request: PushChangesRequestDto
  ): Promise<TenantPushResult> {
    this.logger.log(`Pushing changes for tenant: ${tenant.slug}`);

    try {
      const tenantDb = await this.createTenantConnection(tenant);

      // Set up repositories with tenant database
      this.orderRepository.setDb(tenantDb);
      this.orderChangeRepository.setDb(tenantDb);
      this.orderRepository.setChangeRepository(this.orderChangeRepository);

      // Execute push
      const result = await this.pushChangesUseCase.execute(
        this.orderChangeRepository,
        this.orderRepository,
        this.downstreamAdapter,
        {
          batchSize: request.batchSize,
          orderIds: request.orderIds,
        }
      );

      return {
        tenantSlug: tenant.slug,
        success: result.failedCount === 0,
        totalOrders: result.totalOrders,
        successCount: result.successCount,
        failedCount: result.failedCount,
        orderChangesSynced: result.orderChangesSynced,
        itemChangesSynced: result.itemChangesSynced,
        errors: result.errors,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to push changes for tenant ${tenant.slug}: ${errorMsg}`);

      return {
        tenantSlug: tenant.slug,
        success: false,
        totalOrders: 0,
        successCount: 0,
        failedCount: 0,
        orderChangesSynced: 0,
        itemChangesSynced: 0,
        errors: [errorMsg],
      };
    }
  }

  private async createTenantConnection(tenant: TenantRecord): Promise<TenantDb> {
    const dbName = `tenant_${tenant.slug.replace(/-/g, '_')}`;
    const connection = await mysql.createConnection({
      host: process.env['DB_HOST'] || 'localhost',
      port: parseInt(process.env['DB_PORT'] || '3306'),
      user: process.env['DB_USER'] || 'root',
      password: process.env['DB_PASSWORD'] || '',
      database: dbName,
    });

    return drizzle(connection) as unknown as TenantDb;
  }

  private async getSyncEnabledTenants(): Promise<TenantRecord[]> {
    const results = await getLandlordDb()
      .select()
      .from(tenants)
      .where(
        and(
          eq(tenants.isActive, true),
          eq(tenants.syncEnabled, true)
        )
      );

    return results.map((t) => ({ id: t.id, slug: t.slug }));
  }

  private async getTenantBySlug(slug: string): Promise<TenantRecord[]> {
    const results = await getLandlordDb()
      .select()
      .from(tenants)
      .where(
        and(
          eq(tenants.slug, slug),
          eq(tenants.isActive, true)
        )
      );

    return results.map((t) => ({ id: t.id, slug: t.slug }));
  }
}

