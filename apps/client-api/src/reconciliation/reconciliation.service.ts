import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, like, ne, notExists, or, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import {
  TenantDb,
  reconciliationRuns,
  reconciliationFindings,
  orderItems,
  depTransactions,
} from '@org/database';

export interface CreateRunOptions {
  note?: string;
}

export interface FindingsQuery {
  page?: number;
  limit?: number;
  severity?: 'ok' | 'warn' | 'critical';
  recommendedAction?: string;
  onlyMismatches?: boolean;
  search?: string;
}

function parseList(json: string | null): string[] | null {
  if (json === null || json === undefined) return null;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

@Injectable()
export class ReconciliationService {
  /** Create a run. Rejects if one is already active (worker handles one at a time). */
  async createRun(db: TenantDb, options: CreateRunOptions = {}): Promise<{ runId: string }> {
    const active = await db
      .select({ id: reconciliationRuns.id })
      .from(reconciliationRuns)
      .where(inArray(reconciliationRuns.status, ['pending', 'running']))
      .limit(1);
    if (active.length > 0) {
      throw new ConflictException('A reconciliation run is already in progress');
    }

    const runId = uuidv4();
    const now = new Date();
    await db.insert(reconciliationRuns).values({
      runId,
      status: 'pending',
      scope: options.note ? JSON.stringify({ note: options.note }) : null,
      createdAt: now,
      updatedAt: now,
    });
    return { runId };
  }

  async getRun(db: TenantDb, runId: string) {
    const rows = await db
      .select()
      .from(reconciliationRuns)
      .where(eq(reconciliationRuns.runId, runId))
      .limit(1);
    const run = rows[0];
    if (!run) throw new NotFoundException(`Reconciliation run ${runId} not found`);
    const progress =
      run.totalOrders && run.totalOrders > 0
        ? Math.min(1, run.processedOrders / run.totalOrders)
        : run.status === 'complete'
          ? 1
          : 0;
    return { ...run, progress };
  }

  async listRuns(db: TenantDb, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const items = await db
      .select()
      .from(reconciliationRuns)
      .orderBy(desc(reconciliationRuns.id))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(reconciliationRuns);
    return { items, total: Number(total), page, limit };
  }

  async listFindings(db: TenantDb, runId: string, q: FindingsQuery) {
    const page = q.page && q.page > 0 ? q.page : 1;
    const limit = q.limit && q.limit > 0 ? Math.min(q.limit, 500) : 50;
    const offset = (page - 1) * limit;

    const conds = [eq(reconciliationFindings.runId, runId)];
    if (q.severity) conds.push(eq(reconciliationFindings.severity, q.severity));
    if (q.recommendedAction) {
      conds.push(eq(reconciliationFindings.recommendedAction, q.recommendedAction as never));
    }
    if (q.onlyMismatches) conds.push(ne(reconciliationFindings.severity, 'ok'));
    if (q.search) {
      const term = `%${q.search}%`;
      const match = or(
        like(reconciliationFindings.orderNumber, term),
        like(reconciliationFindings.externalOrderId, term),
      );
      if (match) conds.push(match);
    }
    const where = and(...conds);

    const rows = await db
      .select()
      .from(reconciliationFindings)
      .where(where)
      .orderBy(desc(reconciliationFindings.severity), reconciliationFindings.orderId)
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(reconciliationFindings)
      .where(where);

    const items = rows.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      orderNumber: r.orderNumber,
      externalOrderId: r.externalOrderId,
      ourDevices: parseList(r.ourDevices) ?? [],
      zohoDevices: parseList(r.zohoDevices),
      appleDevices: parseList(r.appleDevices),
      zohoMatch: r.zohoMatch,
      appleMatch: r.appleMatch,
      zohoAdded: parseList(r.zohoAdded) ?? [],
      zohoRemoved: parseList(r.zohoRemoved) ?? [],
      zohoCorrectionApplied: r.zohoCorrectionApplied,
      missingFromApple: parseList(r.missingFromApple) ?? [],
      extraInApple: parseList(r.extraInApple) ?? [],
      recommendedAction: r.recommendedAction,
      severity: r.severity,
    }));

    return { items, total: Number(total), page, limit };
  }

  /** Full findings for a run as a CSV string (no external calls). */
  async exportCsv(db: TenantDb, runId: string): Promise<string> {
    const rows = await db
      .select()
      .from(reconciliationFindings)
      .where(eq(reconciliationFindings.runId, runId))
      .orderBy(reconciliationFindings.orderId);

    const header = [
      'order_number',
      'external_order_id',
      'severity',
      'recommended_action',
      'our_devices',
      'zoho_devices',
      'apple_devices',
      'zoho_match',
      'apple_match',
      'zoho_correction_applied',
      'zoho_added',
      'zoho_removed',
      'missing_from_apple',
      'extra_in_apple',
    ];
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const joinList = (json: string | null) => (parseList(json) ?? []).join(' ');

    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push(
        [
          esc(r.orderNumber),
          esc(r.externalOrderId),
          esc(r.severity),
          esc(r.recommendedAction),
          esc(joinList(r.ourDevices)),
          esc(r.zohoDevices === null ? '' : joinList(r.zohoDevices)),
          esc(r.appleDevices === null ? '' : joinList(r.appleDevices)),
          esc(r.zohoMatch),
          esc(r.appleMatch),
          esc(r.zohoCorrectionApplied),
          esc(joinList(r.zohoAdded)),
          esc(joinList(r.zohoRemoved)),
          esc(joinList(r.missingFromApple)),
          esc(joinList(r.extraInApple)),
        ].join(','),
      );
    }
    return lines.join('\n');
  }

  /** Put a stalled/errored/paused run back into the queue; keeps the cursor. */
  async resume(db: TenantDb, runId: string) {
    const run = await this.getRun(db, runId);
    if (run.status === 'complete' || run.status === 'canceled') {
      throw new ConflictException(`Run ${runId} is ${run.status} and cannot be resumed`);
    }
    await db
      .update(reconciliationRuns)
      .set({ status: 'pending', error: null, updatedAt: new Date() })
      .where(eq(reconciliationRuns.runId, runId));
    return { runId, status: 'pending' as const };
  }

  async cancel(db: TenantDb, runId: string) {
    await this.getRun(db, runId);
    await db
      .update(reconciliationRuns)
      .set({ status: 'canceled', updatedAt: new Date() })
      .where(eq(reconciliationRuns.runId, runId));
    return { runId, status: 'canceled' as const };
  }

  /**
   * Rebuild our order_items from the run's captured Zoho lists (the recovery
   * source): un-delete soft-deleted serials Zoho still lists, insert Zoho
   * serials we have no row for, and set is_dep = 1. Targets findings where our
   * active devices don't match Zoho (zoho_match = false). dryRun reports exactly
   * what it would change, per order, without writing.
   *
   * After executing, re-run the reconciliation report so these orders reclassify
   * as ov_restore, then remediate (OV) to push the devices back into Apple DEP.
   */
  async restoreItems(db: TenantDb, runId: string, opts: { dryRun: boolean; limit?: number }) {
    await this.getRun(db, runId); // 404 if the run doesn't exist

    const where = and(
      eq(reconciliationFindings.runId, runId),
      eq(reconciliationFindings.zohoMatch, false),
    );
    const base = db
      .select({
        orderId: reconciliationFindings.orderId,
        orderNumber: reconciliationFindings.orderNumber,
        zohoDevices: reconciliationFindings.zohoDevices,
      })
      .from(reconciliationFindings)
      .where(where)
      .orderBy(reconciliationFindings.orderId);
    const findings = opts.limit ? await base.limit(opts.limit) : await base;

    const targets = findings
      .map((f) => ({ orderId: f.orderId, orderNumber: f.orderNumber, zoho: parseList(f.zohoDevices) ?? [] }))
      .filter((f) => f.zoho.length > 0);

    const perOrder: { orderId: number; orderNumber: string | null; undelete: string[]; insert: string[] }[] = [];
    const undeleteIds: number[] = [];
    const insertRows: (typeof orderItems.$inferInsert)[] = [];
    const now = new Date();
    const CHUNK = 200;

    for (let i = 0; i < targets.length; i += CHUNK) {
      const slice = targets.slice(i, i + CHUNK);
      const ids = slice.map((s) => s.orderId);
      const rows = await db
        .select({
          id: orderItems.id,
          orderId: orderItems.orderId,
          serialNumber: orderItems.serialNumber,
          deletedAt: orderItems.deletedAt,
        })
        .from(orderItems)
        .where(inArray(orderItems.orderId, ids));

      const byOrder = new Map<number, { id: number; serial: string; deleted: boolean }[]>();
      for (const r of rows) {
        const arr = byOrder.get(r.orderId) ?? [];
        arr.push({ id: r.id, serial: r.serialNumber, deleted: r.deletedAt != null });
        byOrder.set(r.orderId, arr);
      }

      for (const t of slice) {
        const bySerial = new Map((byOrder.get(t.orderId) ?? []).map((it) => [it.serial, it]));
        const undelete: string[] = [];
        const insert: string[] = [];
        for (const serial of t.zoho) {
          const existing = bySerial.get(serial);
          if (!existing) {
            insert.push(serial);
          } else if (existing.deleted) {
            undelete.push(serial);
            undeleteIds.push(existing.id);
          }
        }
        if (undelete.length || insert.length) {
          perOrder.push({ orderId: t.orderId, orderNumber: t.orderNumber, undelete, insert });
          for (const serial of insert) {
            insertRows.push({
              orderId: t.orderId,
              serialNumber: serial,
              isDep: true,
              depStatus: 'pending',
              createdAt: now,
              updatedAt: now,
            });
          }
        }
      }
    }

    if (!opts.dryRun) {
      for (let i = 0; i < undeleteIds.length; i += 500) {
        await db
          .update(orderItems)
          .set({ deletedAt: null, isDep: true, updatedAt: now })
          .where(inArray(orderItems.id, undeleteIds.slice(i, i + 500)));
      }
      for (let i = 0; i < insertRows.length; i += 500) {
        await db.insert(orderItems).values(insertRows.slice(i, i + 500));
      }
    }

    return {
      runId,
      dryRun: opts.dryRun,
      ordersAffected: perOrder.length,
      totalUndelete: undeleteIds.length,
      totalInsert: insertRows.length,
      orders: perOrder,
    };
  }

  /**
   * Remediation candidates: trusted orders (our DB == Zoho) with devices to
   * restore to Apple, each tagged with the DEP action to use —
   *   apple_devices IS NULL  → 'OR' (order gone from Apple; enroll)
   *   otherwise              → 'OV' (order header still in Apple; override —
   *                                  Apple rejects OR on an existing order with
   *                                  DEP-ERR-OR-4110).
   * Excludes orders that already have an OV/OR transaction, so chunked
   * `remediate` calls advance through the backlog instead of re-pushing the same
   * first N (large pushes must be chunked via `limit` to avoid gateway timeouts).
   */
  async getRemediationCandidates(db: TenantDb, runId: string, limit: number) {
    const rows = await db
      .select({
        orderId: reconciliationFindings.orderId,
        orderNumber: reconciliationFindings.orderNumber,
        externalOrderId: reconciliationFindings.externalOrderId,
        appleDevices: reconciliationFindings.appleDevices,
      })
      .from(reconciliationFindings)
      .where(
        and(
          eq(reconciliationFindings.runId, runId),
          eq(reconciliationFindings.zohoMatch, true),
          sql`${reconciliationFindings.zohoDevices} is not null and ${reconciliationFindings.zohoDevices} <> '[]'`,
          // needs restore: order absent from Apple, or missing some devices
          sql`(${reconciliationFindings.appleDevices} is null or ${reconciliationFindings.missingFromApple} <> '[]')`,
          notExists(
            db
              .select({ one: sql`1` })
              .from(depTransactions)
              .where(
                and(
                  eq(depTransactions.orderId, reconciliationFindings.orderId),
                  inArray(depTransactions.orderType, ['OV', 'OR']),
                ),
              ),
          ),
        ),
      )
      .orderBy(reconciliationFindings.orderId)
      .limit(limit);
    return rows.map((r) => ({
      orderId: r.orderId,
      orderNumber: r.orderNumber,
      externalOrderId: r.externalOrderId,
      action: (r.appleDevices === null ? 'OR' : 'OV') as 'OR' | 'OV',
    }));
  }
}
