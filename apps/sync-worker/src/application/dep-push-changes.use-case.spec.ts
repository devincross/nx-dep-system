import { DepPushChangesUseCase } from './dep-push-changes.use-case';

// The use case imports `depTransactions` from the database package (used only
// in the best-effort storeRequest helper) — stub it so the real drizzle/mysql
// module never loads under test.
jest.mock('@org/database', () => ({ depTransactions: {} }));

/**
 * Builds a set of mocked collaborators for DepPushChangesUseCase.execute.
 * `order` and `itemChanges` are the only things a test usually varies.
 */
function harness(opts: {
  order: any;
  itemChanges?: any[];
  orderChanges?: any[];
  enrollTxnId?: string | undefined;
}) {
  const bulkEnrollDevices = jest.fn().mockResolvedValue({
    request: {},
    response: { deviceEnrollmentTransactionId: opts.enrollTxnId ?? 'DET123' },
  });

  const changeRepo: any = {
    findUnsyncedChanges: jest.fn().mockResolvedValue({
      orderChanges: opts.orderChanges ?? [],
      itemChanges: opts.itemChanges ?? [],
    }),
    markOrderChangesSynced: jest.fn().mockResolvedValue(undefined),
    markItemChangesSynced: jest.fn().mockResolvedValue(undefined),
  };
  const orderRepo: any = {
    findById: jest.fn().mockResolvedValue(opts.order),
    markDepSubmitted: jest.fn().mockResolvedValue(undefined),
    recordErpWriteback: jest.fn().mockResolvedValue(undefined),
  };
  const depAdapter: any = { bulkEnrollDevices };
  const txnRepo: any = {
    create: jest.fn().mockResolvedValue(1),
    updateStatus: jest.fn().mockResolvedValue(undefined),
  };
  const accountRepo: any = {
    findById: jest.fn().mockResolvedValue({ depAccountId: 'APPLE_ORG_1' }),
  };

  return { changeRepo, orderRepo, depAdapter, txnRepo, accountRepo, bulkEnrollDevices };
}

/** Returns the orderType (OR/RE/OV/VD) of every bulk-enroll call, in order. */
function submittedTypes(bulkEnrollDevices: jest.Mock): string[] {
  return bulkEnrollDevices.mock.calls.map((c) => c[1][0].orderType);
}

describe('DepPushChangesUseCase — returns un-assign devices from Apple', () => {
  const useCase = new DepPushChangesUseCase();

  it('returns a device even when the return removed the last DEP item (order.isDep is now false)', async () => {
    // The returned device was enrolled (depStatus 'complete'); it was the only
    // DEP item, so the order now has no active DEP items and isDep is false.
    const order = { id: 5, accountId: 1, isDep: false, items: [] };
    const removed = {
      id: 10,
      orderId: 5,
      orderItemId: 100,
      serialNumber: 'ENROLLED1',
      changeType: 'removed',
      snapshot: { serialNumber: 'ENROLLED1', isDep: true, depStatus: 'complete' },
    };
    const h = harness({ order, itemChanges: [removed] });

    const result = await useCase.execute(
      h.changeRepo, h.orderRepo, h.depAdapter, h.txnRepo, h.accountRepo, null,
    );

    // Regression: this used to be skipped by the `if (!order.isDep)` gate,
    // leaving the device enrolled at Apple forever.
    expect(submittedTypes(h.bulkEnrollDevices)).toEqual(['RE']);
    expect(h.bulkEnrollDevices.mock.calls[0][1][0].deliveries[0].devices).toEqual([
      { serialNumber: 'ENROLLED1' },
    ]);
    expect(result.submitted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(h.changeRepo.markItemChangesSynced).toHaveBeenCalledWith([10]);
  });

  it('still skips a non-DEP order whose removed device was never enrolled (depStatus pending)', async () => {
    const order = { id: 6, accountId: 1, isDep: false, items: [] };
    const removed = {
      id: 11,
      orderId: 6,
      serialNumber: 'NEVER1',
      changeType: 'removed',
      snapshot: { serialNumber: 'NEVER1', isDep: false, depStatus: 'pending' },
    };
    const h = harness({ order, itemChanges: [removed] });

    const result = await useCase.execute(
      h.changeRepo, h.orderRepo, h.depAdapter, h.txnRepo, h.accountRepo, null,
    );

    expect(h.bulkEnrollDevices).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(h.changeRepo.markItemChangesSynced).toHaveBeenCalledWith([11]);
  });

  it('returns the dropped device alongside an OV when an order field also changed', async () => {
    // Order still has an active DEP item (isDep true) plus a field change,
    // and a previously-enrolled device was returned in the same cycle.
    const order = {
      id: 7,
      accountId: 1,
      isDep: true,
      externalOrderId: 'ORD7',
      items: [{ serialNumber: 'KEEP1', isDep: true }],
    };
    const orderChange = { id: 70, orderId: 7, changeType: 'updated' };
    const removed = {
      id: 12,
      orderId: 7,
      serialNumber: 'ENROLLED2',
      changeType: 'removed',
      snapshot: { serialNumber: 'ENROLLED2', isDep: true, depStatus: 'submitted' },
    };
    const h = harness({ order, orderChanges: [orderChange], itemChanges: [removed] });

    await useCase.execute(
      h.changeRepo, h.orderRepo, h.depAdapter, h.txnRepo, h.accountRepo, null,
    );

    // OV re-sends the kept device; RE un-assigns the returned one.
    expect(submittedTypes(h.bulkEnrollDevices)).toEqual(['OV', 'RE']);
  });
});

describe('DepPushChangesUseCase — ERP write-back result is recorded', () => {
  const useCase = new DepPushChangesUseCase();
  const order = { id: 7, accountId: 1, isDep: true, externalOrderId: 'SO-7', items: [] };
  const removed = {
    id: 11, orderId: 7, orderItemId: 101, serialNumber: 'ENROLLED1', changeType: 'removed',
    snapshot: { serialNumber: 'ENROLLED1', isDep: true, depStatus: 'complete' },
  };
  // '' = Apple returned no transaction id, i.e. an outright rejection
  const rejected = () => harness({ order, itemChanges: [removed], enrollTxnId: '' });

  it('records success when the rejection reaches NetSuite', async () => {
    const h = rejected();
    const netsuite: any = { updateOrderDepStatus: jest.fn().mockResolvedValue(undefined) };

    await useCase.execute(h.changeRepo, h.orderRepo, h.depAdapter, h.txnRepo, h.accountRepo, netsuite);

    expect(netsuite.updateOrderDepStatus).toHaveBeenCalledWith('SO-7', expect.any(String), 'Error');
    expect(h.orderRepo.recordErpWriteback).toHaveBeenCalledWith(7, null);
  });

  it('records the failure when NetSuite rejects the write-back', async () => {
    const h = rejected();
    const netsuite: any = { updateOrderDepStatus: jest.fn().mockRejectedValue(new Error('RESTlet 500')) };

    await useCase.execute(h.changeRepo, h.orderRepo, h.depAdapter, h.txnRepo, h.accountRepo, netsuite);

    expect(h.orderRepo.recordErpWriteback).toHaveBeenCalledWith(7, expect.stringContaining('RESTlet 500'));
  });
});
