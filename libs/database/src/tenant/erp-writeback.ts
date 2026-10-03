import { eq } from 'drizzle-orm';
import type { TenantDb } from './connection-manager.js';
import { orders } from './schema.js';

/**
 * Record the outcome of an attempt to write DEP status back to the ERP.
 * Success stamps erpSyncedAt and clears the error; failure keeps the last
 * success time and stores the error. Never throws — recording must not turn
 * a best-effort write-back into a pipeline failure.
 */
export async function recordErpWriteback(
  db: TenantDb,
  match: { orderId: number } | { externalOrderId: string },
  error?: string | null,
): Promise<void> {
  try {
    const where =
      'orderId' in match ? eq(orders.id, match.orderId) : eq(orders.externalOrderId, match.externalOrderId);
    await db
      .update(orders)
      .set(error ? { erpSyncError: error.slice(0, 1000) } : { erpSyncedAt: new Date(), erpSyncError: null })
      .where(where);
  } catch {
    /* non-critical */
  }
}
