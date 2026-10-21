import type { ShowOrderDetailsResponse } from '../infrastructure/adapters/dep/dep-sync.adapter.js';

/**
 * Pure helpers for reconciling a tenant's order against Apple DEP and Zoho.
 * No I/O — easy to unit test and shared by the reconciliation worker.
 */

export type ReconciliationAction =
  | 'none'
  | 'ov_restore'
  | 'investigate'
  | 'not_in_apple'
  | 'not_in_zoho';

export type ReconciliationSeverity = 'ok' | 'warn' | 'critical';

export interface DeviceDiff {
  /** Our DB serials (post Zoho-correction), sorted + de-duped */
  our: string[];
  /** Zoho serials, or null when the order is not present in Zoho */
  zoho: string[] | null;
  /** Apple serials, or null when the order is not present in Apple DEP */
  apple: string[] | null;
  /** our === zoho (null when not in Zoho) */
  zohoMatch: boolean | null;
  /** expected === apple (null when not in Apple) */
  appleMatch: boolean | null;
  /** Expected (our ∪ zoho) but NOT in Apple — the wrongly-removed devices */
  missingFromApple: string[];
  /** In Apple but not expected */
  extraInApple: string[];
  recommendedAction: ReconciliationAction;
  severity: ReconciliationSeverity;
}

function normalize(serial: string): string {
  return serial.trim();
}

function toSortedUnique(serials: string[]): string[] {
  return [...new Set(serials.map(normalize).filter((s) => s.length > 0))].sort();
}

function setsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((s) => sa.has(s));
}

/**
 * Index an Apple show-order-details response by order number → sorted serials.
 * Orders Apple did not return are simply absent from the map (caller treats a
 * missing key as "not in Apple").
 */
export function extractAppleSerials(resp: ShowOrderDetailsResponse): Map<string, string[]> {
  const byOrder = new Map<string, string[]>();
  for (const order of resp.orders ?? []) {
    if (!order.orderNumber) continue;
    const serials: string[] = [];
    for (const delivery of order.deliveries ?? []) {
      for (const device of delivery.devices ?? []) {
        if (device.deviceId) serials.push(device.deviceId);
      }
    }
    byOrder.set(order.orderNumber, toSortedUnique(serials));
  }
  return byOrder;
}

/**
 * Compare our (Zoho-corrected) device set against Zoho and Apple, and decide
 * the recommended action + severity.
 *
 * `expected` = our ∪ zoho (defensive union). Devices in `expected` that Apple
 * lacks are the headline signal — devices wrongly removed from Apple.
 * `ov_restore` is only recommended when our DB and Zoho agree AND Apple is the
 * one missing devices, so a later override re-pushes a list we trust.
 */
export function diffDeviceSets(params: {
  our: string[];
  zoho: string[] | null;
  apple: string[] | null;
}): DeviceDiff {
  const our = toSortedUnique(params.our);
  const zoho = params.zoho === null ? null : toSortedUnique(params.zoho);
  const apple = params.apple === null ? null : toSortedUnique(params.apple);

  const expectedSet = new Set(our);
  if (zoho) for (const s of zoho) expectedSet.add(s);
  const expected = [...expectedSet].sort();

  const appleSet = apple === null ? null : new Set(apple);
  const missingFromApple =
    appleSet === null ? [] : expected.filter((s) => !appleSet.has(s));
  const extraInApple =
    appleSet === null ? [] : apple!.filter((s) => !expectedSet.has(s));

  const zohoMatch = zoho === null ? null : setsEqual(our, zoho);
  const appleMatch =
    appleSet === null ? null : missingFromApple.length === 0 && extraInApple.length === 0;

  let recommendedAction: ReconciliationAction;
  if (apple === null) {
    recommendedAction = 'not_in_apple';
  } else if (zoho === null) {
    recommendedAction = missingFromApple.length > 0 ? 'investigate' : 'none';
  } else if (missingFromApple.length > 0 && zohoMatch) {
    recommendedAction = 'ov_restore';
  } else if (missingFromApple.length > 0 || extraInApple.length > 0 || !zohoMatch) {
    recommendedAction = 'investigate';
  } else {
    recommendedAction = 'none';
  }

  let severity: ReconciliationSeverity = 'ok';
  if (missingFromApple.length > 0) {
    severity = 'critical';
  } else if (
    extraInApple.length > 0 ||
    zohoMatch === false ||
    (apple === null && expected.length > 0)
  ) {
    severity = 'warn';
  }

  return {
    our,
    zoho,
    apple,
    zohoMatch,
    appleMatch,
    missingFromApple,
    extraInApple,
    recommendedAction,
    severity,
  };
}
