/**
 * Shared formatting of Apple DEP bulk-enroll / check-transaction responses into
 * a single human-readable error string for storage and ERP (NetSuite/Zoho)
 * write-back.
 *
 * Apple answers HTTP 200 even when it rejects, and the real failure can live in
 * several places. We prefer the most specific signal and GROUP it so a 48-device
 * order that all failed the same way reads as one line, not 48:
 *   1. device-level errors  (orders[].deliveries[].devices[].devicePostStatus)
 *   2. order-level errors   (orders[].orderPostStatus, e.g. DEP-ERR-OR-4109)
 *   3. check-transaction error array (checkTransactionErrorResponse[])
 *   4. top-level / enroll error (errorCode/errorMessage, enrollDeviceErrorResponse)
 *
 * Grouping the device level is the point: previously the ERP got either a generic
 * top-level "Unknown error" or one line per device. Order-level is the fallback
 * so order-only failures (DEP-ERR-OR-41xx) stop surfacing as "Unknown error".
 */

export interface DepDeviceResult {
  deviceId?: string;
  devicePostStatus?: string;
  devicePostStatusMessage?: string;
}

export interface DepDelivery {
  devices?: DepDeviceResult[];
}

export interface DepOrderResult {
  orderNumber?: string;
  orderPostStatus?: string;
  orderPostStatusMessage?: string;
  deliveries?: DepDelivery[];
}

export interface DepErrorEntry {
  errorCode?: string;
  errorMessage?: string;
}

export interface DepResponse {
  statusCode?: string;
  errorCode?: string;
  errorMessage?: string;
  orders?: DepOrderResult[];
  checkTransactionErrorResponse?: DepErrorEntry[];
  enrollDeviceErrorResponse?: DepErrorEntry;
}

const DEFAULT_MESSAGE = 'Apple DEP rejected the submission';

/** `CODE: message`, `CODE`, or `message` — skipping blanks. */
function codeMessage(code?: string, message?: string): string {
  const c = (code ?? '').trim();
  const m = (message ?? '').trim();
  if (c && m) return `${c}: ${m}`;
  return c || m;
}

/** Group device-level errors by their devicePostStatus code, listing devices. */
function groupDeviceErrors(resp: DepResponse): string | null {
  const groups = new Map<string, { message: string; devices: string[] }>();
  for (const order of resp.orders ?? []) {
    for (const delivery of order.deliveries ?? []) {
      for (const device of delivery.devices ?? []) {
        const code = device.devicePostStatus;
        if (!code || code === 'COMPLETE') continue;
        const group = groups.get(code) ?? { message: '', devices: [] };
        if (!group.message && device.devicePostStatusMessage) {
          group.message = device.devicePostStatusMessage;
        }
        if (device.deviceId) group.devices.push(device.deviceId);
        groups.set(code, group);
      }
    }
  }
  if (groups.size === 0) return null;
  return [...groups.entries()]
    .map(([code, g]) => {
      const head = g.message ? `${code} - ${g.message}` : code;
      if (g.devices.length === 0) return head;
      const n = g.devices.length;
      return `${head} (${n} device${n === 1 ? '' : 's'}: ${g.devices.join(', ')})`;
    })
    .join('; ');
}

/** Group order-level errors by their orderPostStatus code, listing orders. */
function groupOrderErrors(resp: DepResponse): string | null {
  const groups = new Map<string, { message: string; orders: string[] }>();
  for (const order of resp.orders ?? []) {
    const code = order.orderPostStatus;
    if (!code || !code.startsWith('DEP-ERR')) continue;
    const group = groups.get(code) ?? { message: '', orders: [] };
    if (!group.message && order.orderPostStatusMessage) {
      group.message = order.orderPostStatusMessage;
    }
    if (order.orderNumber) group.orders.push(order.orderNumber);
    groups.set(code, group);
  }
  if (groups.size === 0) return null;
  return [...groups.entries()]
    .map(([code, g]) => {
      const head = g.message ? `${code} - ${g.message}` : code;
      if (g.orders.length === 0) return head;
      const n = g.orders.length;
      return `${head} (${n} order${n === 1 ? '' : 's'}: ${g.orders.join(', ')})`;
    })
    .join('; ');
}

function arrayErrors(resp: DepResponse): string | null {
  const arr = resp.checkTransactionErrorResponse;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const msgs = arr
    .filter((e) => e?.errorCode || e?.errorMessage)
    .map((e) => codeMessage(e.errorCode, e.errorMessage));
  return msgs.length ? msgs.join('; ') : null;
}

function topLevelError(resp: DepResponse): string | null {
  if (resp.errorCode || resp.errorMessage) {
    return codeMessage(resp.errorCode, resp.errorMessage);
  }
  const ede = resp.enrollDeviceErrorResponse;
  if (ede && (ede.errorCode || ede.errorMessage)) {
    return codeMessage(ede.errorCode, ede.errorMessage);
  }
  return null;
}

/**
 * Build the single error string we store on the transaction and push to the ERP.
 * Prefers grouped device-level errors, then order-level, then the error array,
 * then the top-level error, and finally a generic message.
 */
export function buildDepErrorMessage(response: unknown): string {
  const resp = (response ?? {}) as DepResponse;
  return (
    groupDeviceErrors(resp) ??
    groupOrderErrors(resp) ??
    arrayErrors(resp) ??
    topLevelError(resp) ??
    DEFAULT_MESSAGE
  );
}
