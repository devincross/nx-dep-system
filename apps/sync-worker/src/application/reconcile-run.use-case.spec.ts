import { ReconcileRunUseCase } from './reconcile-run.use-case.js';

function makeMapper() {
  return {
    getIdentifier: () => 'test',
    mapAccount: jest.fn(),
    mapReturn: jest.fn().mockReturnValue(null),
    mapOrder: jest.fn((raw: any) => ({
      externalOrderId: raw.id,
      externalAccountId: 'ACC',
      isDep: true,
      items: (raw.serials as string[]).map((s) => ({
        serialNumber: s,
        isDep: true,
        depStatus: 'pending' as const,
      })),
    })),
  };
}

function makeReconRepo(batches: any[][]) {
  let call = 0;
  return {
    countAllOrders: jest.fn().mockResolvedValue(1),
    markRunning: jest.fn().mockResolvedValue(undefined),
    setZohoIndexed: jest.fn().mockResolvedValue(undefined),
    getRunByRunId: jest.fn().mockResolvedValue({ status: 'running' }),
    nextOrderBatch: jest.fn().mockImplementation(() => Promise.resolve(batches[call++] ?? [])),
    getOrderSerials: jest.fn(),
    upsertFinding: jest.fn().mockResolvedValue(undefined),
    advanceCursor: jest.fn().mockResolvedValue(undefined),
    incrementErrorOrders: jest.fn().mockResolvedValue(undefined),
    recomputeCounts: jest.fn().mockResolvedValue(undefined),
    complete: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
  };
}

const run = { id: 1, runId: 'r1', status: 'pending', cursorOrderId: 0 } as any;

describe('ReconcileRunUseCase', () => {
  it('corrects from Zoho, flags devices missing from Apple as critical, and completes', async () => {
    const uc = new ReconcileRunUseCase();
    const reconRepo = makeReconRepo([
      [{ id: 1, externalOrderId: 'SO-1', depOrderId: null, accountId: 10 }],
      [],
    ]);
    // before correction our DB has only 'A'; after Zoho correction it has 'A','B'
    reconRepo.getOrderSerials
      .mockResolvedValueOnce(['A'])
      .mockResolvedValueOnce(['A', 'B']);

    const orderRepo = { upsert: jest.fn().mockResolvedValue(undefined) } as any;
    const zohoAdapter = {
      fetchOrders: jest.fn().mockResolvedValue({ data: [{ id: 'SO-1', serials: ['A', 'B'] }] }),
    } as any;
    const depAdapter = {
      showOrderDetails: jest.fn().mockResolvedValue({
        response: {
          orders: [{ orderNumber: 'SO-1', deliveries: [{ devices: [{ deviceId: 'A' }] }] }],
        },
      }),
    } as any;

    await uc.processRun({ run, reconRepo: reconRepo as any, orderRepo, zohoAdapter, mapper: makeMapper() as any, depAdapter });

    expect(orderRepo.upsert).toHaveBeenCalledTimes(1); // Zoho correction applied
    const finding = reconRepo.upsertFinding.mock.calls[0][0];
    expect(finding.zohoAdded).toEqual(['B']);
    expect(finding.missingFromApple).toEqual(['B']);
    expect(finding.severity).toBe('critical');
    expect(finding.recommendedAction).toBe('ov_restore');
    expect(reconRepo.advanceCursor).toHaveBeenCalledWith(1, 1);
    expect(reconRepo.complete).toHaveBeenCalledTimes(1);
    expect(reconRepo.fail).not.toHaveBeenCalled();
  });

  it('does NOT advance the cursor and fails the run when the Apple call errors', async () => {
    const uc = new ReconcileRunUseCase();
    const reconRepo = makeReconRepo([
      [{ id: 1, externalOrderId: 'SO-1', depOrderId: null, accountId: 10 }],
    ]);
    reconRepo.getOrderSerials.mockResolvedValue(['A']);

    const orderRepo = { upsert: jest.fn().mockResolvedValue(undefined) } as any;
    const zohoAdapter = {
      fetchOrders: jest.fn().mockResolvedValue({ data: [{ id: 'SO-1', serials: ['A'] }] }),
    } as any;
    const depAdapter = {
      showOrderDetails: jest.fn().mockResolvedValue({
        response: { errorCode: 'OAUTH_SCOPE_MISMATCH', errorMessage: 'nope' },
      }),
    } as any;

    await uc.processRun({ run, reconRepo: reconRepo as any, orderRepo, zohoAdapter, mapper: makeMapper() as any, depAdapter });

    expect(reconRepo.advanceCursor).not.toHaveBeenCalled();
    expect(reconRepo.complete).not.toHaveBeenCalled();
    expect(reconRepo.fail).toHaveBeenCalledTimes(1);
  });
});
