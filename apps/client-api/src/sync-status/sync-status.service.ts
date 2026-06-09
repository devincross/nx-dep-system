import { Injectable, Logger } from '@nestjs/common';
import { eq, desc, and, sql } from 'drizzle-orm';
import { TenantDb, syncStatus, orders, accounts, orderItems } from '@org/database';

export interface SyncStatusResult {
  syncType: 'accounts' | 'orders' | 'full';
  status: 'success' | 'error' | 'running' | 'pending';
  lastSyncAt?: Date;
  lastSuccessAt?: Date;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsErrored: number;
  errorMessage?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface SyncSummary {
  accounts: SyncStatusResult | null;
  orders: SyncStatusResult | null;
  totals: {
    totalAccounts: number;
    totalOrders: number;
    totalOrderItems: number;
  };
}

@Injectable()
export class SyncStatusService {
  private readonly logger = new Logger(SyncStatusService.name);

  /**
   * Get the latest sync status for all sync types
   */
  async getSyncSummary(db: TenantDb): Promise<SyncSummary> {
    const [accountsSync, ordersSync, totals] = await Promise.all([
      this.getLatestSyncStatus(db, 'accounts'),
      this.getLatestSyncStatus(db, 'orders'),
      this.getTotals(db),
    ]);

    return {
      accounts: accountsSync,
      orders: ordersSync,
      totals,
    };
  }

  /**
   * Get the latest sync status for a specific type
   */
  async getLatestSyncStatus(
    db: TenantDb,
    syncType: 'accounts' | 'orders' | 'full'
  ): Promise<SyncStatusResult | null> {
    try {
      const results = await db
        .select()
        .from(syncStatus)
        .where(eq(syncStatus.syncType, syncType))
        .orderBy(desc(syncStatus.createdAt))
        .limit(1);

      if (results.length === 0) {
        return null;
      }

      const row = results[0];
      return {
        syncType: row.syncType,
        status: row.status,
        lastSyncAt: row.lastSyncAt ?? undefined,
        lastSuccessAt: row.lastSuccessAt ?? undefined,
        recordsProcessed: row.recordsProcessed ?? 0,
        recordsCreated: row.recordsCreated ?? 0,
        recordsUpdated: row.recordsUpdated ?? 0,
        recordsErrored: row.recordsErrored ?? 0,
        errorMessage: row.errorMessage ?? undefined,
        startedAt: row.startedAt ?? undefined,
        completedAt: row.completedAt ?? undefined,
      };
    } catch (error) {
      this.logger.error(`Error getting sync status: ${error}`);
      return null;
    }
  }

  /**
   * Get total counts for accounts, orders, and order items
   */
  async getTotals(db: TenantDb): Promise<{
    totalAccounts: number;
    totalOrders: number;
    totalOrderItems: number;
  }> {
    try {
      const [accountCount, orderCount, orderItemCount] = await Promise.all([
        db.select({ count: sql<number>`count(*)` }).from(accounts),
        db.select({ count: sql<number>`count(*)` }).from(orders),
        db.select({ count: sql<number>`count(*)` }).from(orderItems),
      ]);

      return {
        totalAccounts: Number(accountCount[0]?.count ?? 0),
        totalOrders: Number(orderCount[0]?.count ?? 0),
        totalOrderItems: Number(orderItemCount[0]?.count ?? 0),
      };
    } catch (error) {
      this.logger.error(`Error getting totals: ${error}`);
      return {
        totalAccounts: 0,
        totalOrders: 0,
        totalOrderItems: 0,
      };
    }
  }

  /**
   * Get recent sync history
   */
  async getSyncHistory(
    db: TenantDb,
    limit: number = 10
  ): Promise<SyncStatusResult[]> {
    try {
      const results = await db
        .select()
        .from(syncStatus)
        .orderBy(desc(syncStatus.createdAt))
        .limit(limit);

      return results.map((row) => ({
        syncType: row.syncType,
        status: row.status,
        lastSyncAt: row.lastSyncAt ?? undefined,
        lastSuccessAt: row.lastSuccessAt ?? undefined,
        recordsProcessed: row.recordsProcessed ?? 0,
        recordsCreated: row.recordsCreated ?? 0,
        recordsUpdated: row.recordsUpdated ?? 0,
        recordsErrored: row.recordsErrored ?? 0,
        errorMessage: row.errorMessage ?? undefined,
        startedAt: row.startedAt ?? undefined,
        completedAt: row.completedAt ?? undefined,
      }));
    } catch (error) {
      this.logger.error(`Error getting sync history: ${error}`);
      return [];
    }
  }
}

