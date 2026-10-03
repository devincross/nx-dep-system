import { toSyncStatusResult } from './sync-status.service';

jest.mock('@org/database', () => ({}));

describe('toSyncStatusResult staleness', () => {
  const now = new Date('2026-01-01T12:00:00Z');
  const minsAgo = (m: number) => new Date(now.getTime() - m * 60 * 1000);
  const row = (over: Record<string, unknown>) =>
    ({
      syncType: 'orders',
      status: 'success',
      recordsProcessed: 0,
      startedAt: minsAgo(5),
      completedAt: minsAgo(4),
      createdAt: minsAgo(5),
      ...over,
    }) as any;

  it('is not stale for a recent success', () => {
    expect(toSyncStatusResult(row({}), now).stale).toBeUndefined();
  });

  it('flags a run stuck in running (worker crashed mid-sync)', () => {
    const r = toSyncStatusResult(row({ status: 'running', startedAt: minsAgo(45), completedAt: null }), now);
    expect(r.stale).toBe('stuck_running');
  });

  it('does not flag a run that has only just started', () => {
    const r = toSyncStatusResult(row({ status: 'running', startedAt: minsAgo(2), completedAt: null }), now);
    expect(r.stale).toBeUndefined();
  });

  it('flags overdue when nothing has run for over an hour, even after a success', () => {
    const r = toSyncStatusResult(row({ startedAt: minsAgo(190), completedAt: minsAgo(189), createdAt: minsAgo(190) }), now);
    expect(r.stale).toBe('overdue');
  });

  it('flags overdue after an old failure too, keeping the error message', () => {
    const r = toSyncStatusResult(
      row({ status: 'error', errorMessage: 'boom', startedAt: minsAgo(300), completedAt: minsAgo(299) }),
      now,
    );
    expect(r.stale).toBe('overdue');
    expect(r.errorMessage).toBe('boom');
  });
});
