import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import {
  reconciliationRuns,
  reconciliationFindings,
  orders,
  orderItems,
  TenantDb,
  ReconciliationRun,
} from '@org/database';

export interface ReconcileOrderRow {
  id: number;
  externalOrderId: string | null;
  depOrderId: string | null;
  accountId: number;
}

export interface FindingInput {
  runId: string;
  orderId: number;
  orderNumber: string;
  externalOrderId: string | null;
  ourDevices: string[];
  zohoDevices: string[] | null;
  appleDevices: string[] | null;
  zohoMatch: boolean | null;
  appleMatch: boolean | null;
  zohoAdded: string[];
  zohoRemoved: string[];
  zohoCorrectionApplied: boolean;
  missingFromApple: string[];
  extraInApple: string[];
  recommendedAction:
    | 'none'
    | 'ov_restore'
    | 'investigate'
    | 'not_in_apple'
    | 'not_in_zoho';
  severity: 'ok' | 'warn' | 'critical';
}

/**
 * DB access for reconciliation runs + findings and the order/item reads the
 * worker needs. Scoped to one tenant via setDb (same pattern as the other
 * sync-worker repositories).
 */
@Injectable()
export class ReconciliationRepository {
  private db: TenantDb | null = null;

  setDb(db: TenantDb): void {
    this.db = db;
  }

  private ensureDb(): TenantDb {
    if (!this.db) throw new Error('Database not set. Call setDb() first.');
    return this.db;
  }

  /** The single run the worker should advance next (oldest active first). */
  async findActiveRun(): Promise<ReconciliationRun | null> {
    const db = this.ensureDb();
    const rows = await db
      .select()
      .from(reconciliationRuns)
      .where(inArray(reconciliationRuns.status, ['pending', 'running']))
      .orderBy(asc(reconciliationRuns.id))
      .limit(1);
    return rows[0] ?? null;
  }

  async getRunByRunId(runId: string): Promise<ReconciliationRun | null> {
    const db = this.ensureDb();
    const rows = await db
      .select()
      .from(reconciliationRuns)
      .where(eq(reconciliationRuns.runId, runId))
      .limit(1);
    return rows[0] ?? null;
  }

  async countAllOrders(): Promise<number> {
    const db = this.ensureDb();
    const [row] = await db.select({ n: sql<number>`count(*)` }).from(orders);
    return Number(row?.n ?? 0);
  }

  async markRunning(id: number, totalOrders: number): Promise<void> {
    const db = this.ensureDb();
    await db
      .update(reconciliationRuns)
      .set({ status: 'running', totalOrders, startedAt: new Date(), updatedAt: new Date() })
      .where(eq(reconciliationRuns.id, id));
  }

  async setZohoIndexed(id: number): Promise<void> {
    const db = this.ensureDb();
    await db
      .update(reconciliationRuns)
      .set({ zohoIndexedAt: new Date(), updatedAt: new Date() })
      .where(eq(reconciliationRuns.id, id));
  }

  /** Next batch of orders past the checkpoint, ascending by id. */
  async nextOrderBatch(cursorOrderId: number, limit: number): Promise<ReconcileOrderRow[]> {
    const db = this.ensureDb();
    return db
      .select({
        id: orders.id,
        externalOrderId: orders.externalOrderId,
        depOrderId: orders.depOrderId,
        accountId: orders.accountId,
      })
      .from(orders)
      .where(gt(orders.id, cursorOrderId))
      .orderBy(asc(orders.id))
      .limit(limit);
  }

  /** Live, non-deleted serial numbers for an order. */
  async getOrderSerials(orderId: number): Promise<string[]> {
    const db = this.ensureDb();
    const rows = await db
      .select({ serialNumber: orderItems.serialNumber })
      .from(orderItems)
      .where(and(eq(orderItems.orderId, orderId), isNull(orderItems.deletedAt)));
    return rows.map((r) => r.serialNumber);
  }

  /** Idempotent upsert of a finding keyed on (runId, orderId). */
  async upsertFinding(f: FindingInput): Promise<void> {
    const db = this.ensureDb();
    const now = new Date();
    const values = {
      runId: f.runId,
      orderId: f.orderId,
      orderNumber: f.orderNumber,
      externalOrderId: f.externalOrderId,
      ourDevices: JSON.stringify(f.ourDevices),
      zohoDevices: f.zohoDevices === null ? null : JSON.stringify(f.zohoDevices),
      appleDevices: f.appleDevices === null ? null : JSON.stringify(f.appleDevices),
      zohoMatch: f.zohoMatch,
      appleMatch: f.appleMatch,
      zohoAdded: JSON.stringify(f.zohoAdded),
      zohoRemoved: JSON.stringify(f.zohoRemoved),
      zohoCorrectionApplied: f.zohoCorrectionApplied,
      missingFromApple: JSON.stringify(f.missingFromApple),
      extraInApple: JSON.stringify(f.extraInApple),
      recommendedAction: f.recommendedAction,
      severity: f.severity,
      createdAt: now,
      updatedAt: now,
    };
    await db
      .insert(reconciliationFindings)
      .values(values)
      .onDuplicateKeyUpdate({
        set: {
          orderNumber: values.orderNumber,
          externalOrderId: values.externalOrderId,
          ourDevices: values.ourDevices,
          zohoDevices: values.zohoDevices,
          appleDevices: values.appleDevices,
          zohoMatch: values.zohoMatch,
          appleMatch: values.appleMatch,
          zohoAdded: values.zohoAdded,
          zohoRemoved: values.zohoRemoved,
          zohoCorrectionApplied: values.zohoCorrectionApplied,
          missingFromApple: values.missingFromApple,
          extraInApple: values.extraInApple,
          recommendedAction: values.recommendedAction,
          severity: values.severity,
          updatedAt: now,
        },
      });
  }

  /** Advance the durable checkpoint after a batch is fully written. */
  async advanceCursor(id: number, cursorOrderId: number): Promise<void> {
    const db = this.ensureDb();
    await db
      .update(reconciliationRuns)
      .set({ cursorOrderId, updatedAt: new Date() })
      .where(eq(reconciliationRuns.id, id));
  }

  async incrementErrorOrders(id: number, n: number): Promise<void> {
    if (n <= 0) return;
    const db = this.ensureDb();
    await db
      .update(reconciliationRuns)
      .set({
        errorOrderCount: sql`${reconciliationRuns.errorOrderCount} + ${n}`,
        updatedAt: new Date(),
      })
      .where(eq(reconciliationRuns.id, id));
  }

  /**
   * Recompute the run's summary counts from its findings. Authoritative and
   * replay-safe (idempotent upserts mean a re-processed batch can't double
   * count). Call after each batch for live progress.
   */
  async recomputeCounts(id: number, runId: string): Promise<void> {
    const db = this.ensureDb();
    const [row] = await db
      .select({
        processed: sql<number>`count(*)`,
        zohoCorrected: sql<number>`sum(case when ${reconciliationFindings.zohoCorrectionApplied} = true then 1 else 0 end)`,
        zohoMismatch: sql<number>`sum(case when ${reconciliationFindings.zohoMatch} = false then 1 else 0 end)`,
        appleMatch: sql<number>`sum(case when ${reconciliationFindings.appleMatch} = true then 1 else 0 end)`,
        missingFromApple: sql<number>`sum(case when ${reconciliationFindings.missingFromApple} is not null and ${reconciliationFindings.missingFromApple} <> '[]' then 1 else 0 end)`,
        extraInApple: sql<number>`sum(case when ${reconciliationFindings.extraInApple} is not null and ${reconciliationFindings.extraInApple} <> '[]' then 1 else 0 end)`,
        critical: sql<number>`sum(case when ${reconciliationFindings.severity} = 'critical' then 1 else 0 end)`,
      })
      .from(reconciliationFindings)
      .where(eq(reconciliationFindings.runId, runId));

    await db
      .update(reconciliationRuns)
      .set({
        processedOrders: Number(row?.processed ?? 0),
        zohoCorrectedCount: Number(row?.zohoCorrected ?? 0),
        zohoMismatchCount: Number(row?.zohoMismatch ?? 0),
        appleMatchCount: Number(row?.appleMatch ?? 0),
        missingFromAppleCount: Number(row?.missingFromApple ?? 0),
        extraInAppleCount: Number(row?.extraInApple ?? 0),
        criticalCount: Number(row?.critical ?? 0),
        updatedAt: new Date(),
      })
      .where(eq(reconciliationRuns.id, id));
  }

  async complete(id: number): Promise<void> {
    const db = this.ensureDb();
    await db
      .update(reconciliationRuns)
      .set({ status: 'complete', completedAt: new Date(), updatedAt: new Date() })
      .where(eq(reconciliationRuns.id, id));
  }

  async fail(id: number, error: string): Promise<void> {
    const db = this.ensureDb();
    await db
      .update(reconciliationRuns)
      .set({ status: 'error', error: error.slice(0, 2000), updatedAt: new Date() })
      .where(eq(reconciliationRuns.id, id));
  }
}
