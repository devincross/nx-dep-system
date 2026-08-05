import { Test, TestingModule } from '@nestjs/testing';
import { OrderRepository } from './order.repository';
import { OrderChangeRepositoryPort } from '../../domain/ports/repository.port';
import { OrderEntity, PersistedOrderEntity, PersistedOrderItemEntity } from '../../domain/entities/index';

// Mock the database module
jest.mock('@org/database', () => ({
  orders: {
    id: 'id',
    orderId: 'orderId',
    accountId: 'accountId',
    externalOrderId: 'externalOrderId',
    externalOrderStatus: 'externalOrderStatus',
    status: 'status',
    po: 'po',
  },
  orderItems: {
    id: 'id',
    orderId: 'orderId',
    serialNumber: 'serialNumber',
    isDep: 'isDep',
    depStatus: 'depStatus',
    deletedAt: 'deletedAt',
  },
}));

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-1234'),
}));

describe('OrderRepository - Change Detection', () => {
  let repository: OrderRepository;
  let mockChangeRepository: jest.Mocked<OrderChangeRepositoryPort>;

  const createMockOrder = (overrides: Partial<PersistedOrderEntity> = {}): PersistedOrderEntity => ({
    id: 1,
    orderId: 'order-uuid-1',
    accountId: 100,
    externalOrderId: 'EXT-001',
    externalAccountId: 'EXT-ACC-001',
    externalOrderStatus: 'pending',
    isDep: true,
    status: 'waiting',
    po: 'PO-001',
    source: 'netsuite',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    items: [],
    ...overrides,
  });

  const createMockItem = (overrides: Partial<PersistedOrderItemEntity> = {}): PersistedOrderItemEntity => ({
    id: 1,
    orderId: 1,
    serialNumber: 'SN-001',
    isDep: true,
    depStatus: 'pending',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  });

  const createIncomingOrder = (overrides: Partial<OrderEntity> = {}): OrderEntity => ({
    externalOrderId: 'EXT-001',
    externalAccountId: 'EXT-ACC-001',
    externalOrderStatus: 'pending',
    isDep: true,
    po: 'PO-001',
    source: 'netsuite',
    items: [],
    ...overrides,
  });

  // Creates a mock database that returns specified values in sequence
  const createMockDb = () => {
    const mockDb: any = {};

    // Build chainable query builder
    mockDb.select = jest.fn(() => mockDb);
    mockDb.from = jest.fn(() => mockDb);
    mockDb.where = jest.fn(() => mockDb);
    mockDb.limit = jest.fn(() => Promise.resolve([]));
    mockDb.insert = jest.fn(() => mockDb);
    mockDb.values = jest.fn(() => Promise.resolve([{ insertId: BigInt(1) }]));
    mockDb.update = jest.fn(() => mockDb);
    mockDb.set = jest.fn(() => mockDb);

    return mockDb;
  };

  beforeEach(async () => {
    // Create mock change repository
    mockChangeRepository = {
      recordOrderChange: jest.fn().mockResolvedValue({ id: 1 }),
      recordItemChange: jest.fn().mockResolvedValue({ id: 1 }),
      recordItemChanges: jest.fn().mockResolvedValue([]),
      findUnsyncedChanges: jest.fn().mockResolvedValue({ orderChanges: [], itemChanges: [] }),
      findUnsyncedChangesByOrderId: jest.fn().mockResolvedValue({ orderChanges: [], itemChanges: [] }),
      markOrderChangesSynced: jest.fn().mockResolvedValue(undefined),
      markItemChangesSynced: jest.fn().mockResolvedValue(undefined),
      markOrderFullySynced: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [OrderRepository],
    }).compile();

    repository = module.get<OrderRepository>(OrderRepository);
    repository.setChangeRepository(mockChangeRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('when creating a new order', () => {
    it('should record order creation change', async () => {
      const mockDb = createMockDb();
      repository.setDb(mockDb);

      const incomingOrder = createIncomingOrder({
        items: [{ serialNumber: 'SN-001', isDep: true, depStatus: 'pending' }],
      });

      // Mock: no existing order found, then insert succeeds
      mockDb.limit.mockResolvedValue([]);
      mockDb.values
        .mockResolvedValueOnce([{ insertId: BigInt(1) }])
        .mockResolvedValueOnce([{ insertId: BigInt(10) }]);

      await repository.upsert(incomingOrder, 100);

      expect(mockChangeRepository.recordOrderChange).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 1,
          changeType: 'created',
          snapshot: expect.objectContaining({
            externalOrderId: 'EXT-001',
          }),
        })
      );
    });

    it('should record all items as added when order is created', async () => {
      const mockDb = createMockDb();
      repository.setDb(mockDb);

      const incomingOrder = createIncomingOrder({
        items: [
          { serialNumber: 'SN-001', isDep: true, depStatus: 'pending' },
          { serialNumber: 'SN-002', isDep: false, depStatus: 'pending' },
        ],
      });

      mockDb.limit.mockResolvedValue([]);
      mockDb.values
        .mockResolvedValueOnce([{ insertId: BigInt(1) }])
        .mockResolvedValueOnce([{ insertId: BigInt(10) }])
        .mockResolvedValueOnce([{ insertId: BigInt(11) }]);

      await repository.upsert(incomingOrder, 100);

      expect(mockChangeRepository.recordItemChanges).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            serialNumber: 'SN-001',
            changeType: 'added',
          }),
          expect.objectContaining({
            serialNumber: 'SN-002',
            changeType: 'added',
          }),
        ])
      );
    });
  });

  describe('when updating an existing order', () => {
    it('should record order field changes when status changes', async () => {
      const existingOrder = createMockOrder({
        externalOrderStatus: 'pending',
        items: [],
      });

      const incomingOrder = createIncomingOrder({
        externalOrderStatus: 'shipped', // Changed from 'pending'
        items: [],
      });

      // Use spy to mock findByExternalId directly
      const findSpy = jest.spyOn(repository, 'findByExternalId')
        .mockResolvedValueOnce(existingOrder) // First call: find existing
        .mockResolvedValueOnce({ ...existingOrder, externalOrderStatus: 'shipped' }); // After update

      const mockDb = createMockDb();
      repository.setDb(mockDb);

      await repository.upsert(incomingOrder, 100);

      expect(mockChangeRepository.recordOrderChange).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: existingOrder.id,
          changeType: 'updated',
          changedFields: expect.objectContaining({
            externalOrderStatus: { old: 'pending', new: 'shipped' },
          }),
        })
      );

      findSpy.mockRestore();
    });

    it('should record PO changes', async () => {
      const existingOrder = createMockOrder({
        po: 'PO-001',
        items: [],
      });

      const incomingOrder = createIncomingOrder({
        po: 'PO-002', // Changed
        items: [],
      });

      const findSpy = jest.spyOn(repository, 'findByExternalId')
        .mockResolvedValueOnce(existingOrder)
        .mockResolvedValueOnce({ ...existingOrder, po: 'PO-002' });

      const mockDb = createMockDb();
      repository.setDb(mockDb);

      await repository.upsert(incomingOrder, 100);

      expect(mockChangeRepository.recordOrderChange).toHaveBeenCalledWith(
        expect.objectContaining({
          changeType: 'updated',
          changedFields: expect.objectContaining({
            po: { old: 'PO-001', new: 'PO-002' },
          }),
        })
      );

      findSpy.mockRestore();
    });

    it('should NOT record changes when nothing changed', async () => {
      const existingOrder = createMockOrder({
        externalOrderStatus: 'pending',
        po: 'PO-001',
        items: [],
      });

      const incomingOrder = createIncomingOrder({
        externalOrderStatus: 'pending', // Same
        po: 'PO-001', // Same
        items: [],
      });

      const findSpy = jest.spyOn(repository, 'findByExternalId')
        .mockResolvedValueOnce(existingOrder)
        .mockResolvedValueOnce(existingOrder);

      const mockDb = createMockDb();
      repository.setDb(mockDb);

      await repository.upsert(incomingOrder, 100);

      // Should NOT have recorded an order change since nothing changed
      expect(mockChangeRepository.recordOrderChange).not.toHaveBeenCalled();

      findSpy.mockRestore();
    });
  });

  describe('when items are added to an existing order', () => {
    it('should record new items as added', async () => {
      const existingItem = createMockItem({ serialNumber: 'SN-001' });
      const existingOrder = createMockOrder({
        items: [existingItem],
      });

      const incomingOrder = createIncomingOrder({
        items: [
          { serialNumber: 'SN-001', isDep: true, depStatus: 'pending' }, // Existing
          { serialNumber: 'SN-002', isDep: true, depStatus: 'pending' }, // New
        ],
      });

      const findSpy = jest.spyOn(repository, 'findByExternalId')
        .mockResolvedValueOnce(existingOrder)
        .mockResolvedValueOnce(existingOrder);

      const mockDb = createMockDb();
      mockDb.values.mockResolvedValueOnce([{ insertId: BigInt(20) }]);
      repository.setDb(mockDb);

      await repository.upsert(incomingOrder, 100);

      expect(mockChangeRepository.recordItemChanges).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            serialNumber: 'SN-002',
            changeType: 'added',
            orderItemId: 20,
          }),
        ])
      );

      findSpy.mockRestore();
    });
  });

  describe('when items are removed from an existing order', () => {
    it('should record removed items', async () => {
      const existingItem1 = createMockItem({ id: 1, serialNumber: 'SN-001' });
      const existingItem2 = createMockItem({ id: 2, serialNumber: 'SN-002' });
      const existingOrder = createMockOrder({
        items: [existingItem1, existingItem2],
      });

      // Incoming order only has SN-001, so SN-002 is removed
      const incomingOrder = createIncomingOrder({
        items: [
          { serialNumber: 'SN-001', isDep: true, depStatus: 'pending' },
        ],
      });

      const findSpy = jest.spyOn(repository, 'findByExternalId')
        .mockResolvedValueOnce(existingOrder)
        .mockResolvedValueOnce({ ...existingOrder, items: [existingItem1] });

      const mockDb = createMockDb();
      repository.setDb(mockDb);

      await repository.upsert(incomingOrder, 100);

      expect(mockChangeRepository.recordItemChanges).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            serialNumber: 'SN-002',
            changeType: 'removed',
            orderItemId: 2,
          }),
        ])
      );

      findSpy.mockRestore();
    });
  });

  describe('when items are updated', () => {
    it('should record item field changes', async () => {
      const existingItem = createMockItem({
        id: 1,
        serialNumber: 'SN-001',
        isDep: false,
        depStatus: 'pending',
      });
      const existingOrder = createMockOrder({
        items: [existingItem],
      });

      const incomingOrder = createIncomingOrder({
        items: [
          {
            serialNumber: 'SN-001',
            isDep: true, // Changed from false to true
            depStatus: 'pending',
          },
        ],
      });

      const findSpy = jest.spyOn(repository, 'findByExternalId')
        .mockResolvedValueOnce(existingOrder)
        .mockResolvedValueOnce({ ...existingOrder, items: [{ ...existingItem, isDep: true }] });

      const mockDb = createMockDb();
      repository.setDb(mockDb);

      await repository.upsert(incomingOrder, 100);

      expect(mockChangeRepository.recordItemChanges).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            serialNumber: 'SN-001',
            changeType: 'updated',
            changedFields: expect.objectContaining({
              isDep: { old: false, new: true },
            }),
          }),
        ])
      );

      findSpy.mockRestore();
    });

    it('should NOT sync depStatus from upstream (owned by the DEP pipeline)', async () => {
      // The poll scheduler marked this item complete; the mapper always
      // emits 'pending' — a re-sync must not revert the enrollment status
      const existingItem = createMockItem({
        serialNumber: 'SN-001',
        isDep: true,
        depStatus: 'complete',
      });
      const existingOrder = createMockOrder({
        items: [existingItem],
      });

      const incomingOrder = createIncomingOrder({
        items: [
          { serialNumber: 'SN-001', isDep: true, depStatus: 'pending' },
        ],
      });

      const findSpy = jest.spyOn(repository, 'findByExternalId')
        .mockResolvedValueOnce(existingOrder)
        .mockResolvedValueOnce(existingOrder);

      const mockDb = createMockDb();
      repository.setDb(mockDb);

      await repository.upsert(incomingOrder, 100);

      expect(mockChangeRepository.recordItemChanges).not.toHaveBeenCalled();
      // No write may touch depStatus (the order-row refresh still runs)
      for (const [setArg] of (mockDb.set as jest.Mock).mock.calls) {
        expect(setArg).not.toHaveProperty('depStatus');
      }

      findSpy.mockRestore();
    });

    it('should NOT record item changes when nothing changed', async () => {
      const existingItem = createMockItem({
        serialNumber: 'SN-001',
        isDep: true,
        depStatus: 'pending',
      });
      const existingOrder = createMockOrder({
        items: [existingItem],
      });

      const incomingOrder = createIncomingOrder({
        items: [
          {
            serialNumber: 'SN-001',
            isDep: true, // Same
            depStatus: 'pending', // Same
          },
        ],
      });

      const findSpy = jest.spyOn(repository, 'findByExternalId')
        .mockResolvedValueOnce(existingOrder)
        .mockResolvedValueOnce(existingOrder);

      const mockDb = createMockDb();
      repository.setDb(mockDb);

      await repository.upsert(incomingOrder, 100);

      // Should NOT have recorded any item changes
      expect(mockChangeRepository.recordItemChanges).not.toHaveBeenCalled();

      findSpy.mockRestore();
    });
  });

  describe('when change repository is not set', () => {
    it('should still process upsert without recording changes', async () => {
      const mockDb = createMockDb();
      repository.setDb(mockDb);

      // Remove change repository
      repository.setChangeRepository(null as any);

      const incomingOrder = createIncomingOrder({
        items: [{ serialNumber: 'SN-001', isDep: true, depStatus: 'pending' }],
      });

      // Mock: no existing order found
      mockDb.limit.mockResolvedValue([]);
      mockDb.values
        .mockResolvedValueOnce([{ insertId: BigInt(1) }])
        .mockResolvedValueOnce([{ insertId: BigInt(10) }]);

      const result = await repository.upsert(incomingOrder, 100);

      expect(result.created).toBe(true);
      expect(mockChangeRepository.recordOrderChange).not.toHaveBeenCalled();
    });
  });
});
