export type DepAction = 'enroll' | 'void' | 'override';

export interface DepActionResult {
  orderId: number;
  action: string;
  success: boolean;
  message: string;
}

export const depActionCopy: Record<DepAction, { title: string; body: string }> = {
  enroll: { title: 'Enroll devices', body: 'Submit all Apple-eligible devices on this order to Apple Device Enrollment.' },
  override: { title: 'Override enrollment', body: "Replace Apple's device list for this order with the devices currently on it." },
  void: { title: 'Void order', body: 'Void this order at Apple. Its devices will no longer be enrolled.' },
};

// Apple answers HTTP 200 even when it rejects a submission, so read `accepted`.
// Acceptance only means the request is queued — the order status updates once
// the poller sees Apple's final result.
export function toDepResult(
  orderId: number,
  action: string,
  data: { transactionId: string; accepted?: boolean; errorMessage?: string | null },
): DepActionResult {
  return data.accepted === false
    ? { orderId, action, success: false, message: `Apple rejected the submission: ${data.errorMessage || 'unknown error'} (Reference: ${data.transactionId})` }
    : { orderId, action, success: true, message: `Submitted to Apple — awaiting result, which can take several minutes. Reference: ${data.transactionId}` };
}
