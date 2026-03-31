import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SyncStatusService } from './sync-status.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentTenant } from '../tenant/tenant.decorator.js';
import type { TenantContext } from '../tenant/tenant-context.service.js';

@Controller('sync-status')
@UseGuards(JwtAuthGuard)
export class SyncStatusController {
  constructor(private readonly syncStatusService: SyncStatusService) {}

  /**
   * Get sync summary including latest sync status and totals
   */
  @Get('summary')
  async getSummary(@CurrentTenant() tenant: TenantContext) {
    return this.syncStatusService.getSyncSummary(tenant.db);
  }

  /**
   * Get latest sync status for accounts
   */
  @Get('accounts')
  async getAccountsSync(@CurrentTenant() tenant: TenantContext) {
    return this.syncStatusService.getLatestSyncStatus(tenant.db, 'accounts');
  }

  /**
   * Get latest sync status for orders
   */
  @Get('orders')
  async getOrdersSync(@CurrentTenant() tenant: TenantContext) {
    return this.syncStatusService.getLatestSyncStatus(tenant.db, 'orders');
  }

  /**
   * Get sync history
   */
  @Get('history')
  async getHistory(@CurrentTenant() tenant: TenantContext, @Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.syncStatusService.getSyncHistory(tenant.db, Math.min(limitNum, 50));
  }
}
