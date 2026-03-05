import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { SyncStatusService } from './sync-status.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

@Controller('sync-status')
@UseGuards(JwtAuthGuard)
export class SyncStatusController {
  constructor(private readonly syncStatusService: SyncStatusService) {}

  /**
   * Get sync summary including latest sync status and totals
   */
  @Get('summary')
  async getSummary(@Request() req: any) {
    const db = req.tenantDb;
    return this.syncStatusService.getSyncSummary(db);
  }

  /**
   * Get latest sync status for accounts
   */
  @Get('accounts')
  async getAccountsSync(@Request() req: any) {
    const db = req.tenantDb;
    return this.syncStatusService.getLatestSyncStatus(db, 'accounts');
  }

  /**
   * Get latest sync status for orders
   */
  @Get('orders')
  async getOrdersSync(@Request() req: any) {
    const db = req.tenantDb;
    return this.syncStatusService.getLatestSyncStatus(db, 'orders');
  }

  /**
   * Get sync history
   */
  @Get('history')
  async getHistory(@Request() req: any, @Query('limit') limit?: string) {
    const db = req.tenantDb;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.syncStatusService.getSyncHistory(db, Math.min(limitNum, 50));
  }
}

