import { Test, TestingModule } from '@nestjs/testing';
import { OrderChangeRepository } from './order-change.repository';

// Mock the database module
jest.mock('@org/database', () => ({
  orderChanges: {
    id: 'id',
    orderId: 'orderId',
    changeType: 'changeType',
    changedFields: 'changedFields',
    snapshot: 'snapshot',
    syncedAt: 'syncedAt',
    createdAt: 'createdAt',
    $inferSelect: {},
  },
  orderItemChanges: {
    id: 'id',
    orderId: 'orderId',
    orderItemId: 'orderItemId',
    serialNumber: 'serialNumber',
    changeType: 'changeType',
    changedFields: 'changedFields',
    snapshot: 'snapshot',
    syncedAt: 'syncedAt',
    createdAt: 'createdAt',
    $inferSelect: {},
  },
}));

describe('OrderChangeRepository', () => {
  let repository: OrderChangeRepository;
  let mockDb: any;

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([]),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockResolvedValue([{ insertId: BigInt(1) }]),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [OrderChangeRepository],
    }).compile();

    repository = module.get<OrderChangeRepository>(OrderChangeRepository);
    repository.setDb(mockDb);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('recordOrderChange', () => {
    it('should insert an order change record', async () => {
      const change = {
        orderId: 1,
        changeType: 'created' as const,
        snapshot: { externalOrderId: 'EXT-001' },
      };

      const result = await repository.recordOrderChange(change);

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 1,
          changeType: 'created',
          snapshot: JSON.stringify({ externalOrderId: 'EXT-001' }),
        })
      );
      expect(result.id).toBe(1);
      expect(result.orderId).toBe(1);
      expect(result.changeType).toBe('created');
    });

    it('should serialize changedFields to JSON', async () => {
      const change = {
        orderId: 1,
        changeType: 'updated' as const,
        changedFields: {
          status: { old: 'pending', new: 'shipped' },
        },
      };

      await repository.recordOrderChange(change);

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          changedFields: JSON.stringify({ status: { old: 'pending', new: 'shipped' } }),
        })
      );
    });
  });

  describe('recordItemChange', () => {
    it('should insert an item change record', async () => {
      const change = {
        orderId: 1,
        orderItemId: 10,
        serialNumber: 'SN-001',
        changeType: 'added' as const,
        snapshot: { isDep: true },
      };

      const result = await repository.recordItemChange(change);

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 1,
          orderItemId: 10,
          serialNumber: 'SN-001',
          changeType: 'added',
        })
      );
      expect(result.id).toBe(1);
      expect(result.serialNumber).toBe('SN-001');
    });

    it('should handle removed items (null orderItemId)', async () => {
      const change = {
        orderId: 1,
        orderItemId: undefined,
        serialNumber: 'SN-001',
        changeType: 'removed' as const,
      };

      await repository.recordItemChange(change);

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          orderItemId: null,
          changeType: 'removed',
        })
      );
    });
  });

  describe('recordItemChanges', () => {
    it('should record multiple item changes', async () => {
      const changes = [
        { orderId: 1, serialNumber: 'SN-001', changeType: 'added' as const },
        { orderId: 1, serialNumber: 'SN-002', changeType: 'removed' as const },
      ];

      mockDb.values
        .mockResolvedValueOnce([{ insertId: BigInt(1) }])
        .mockResolvedValueOnce([{ insertId: BigInt(2) }]);

      const results = await repository.recordItemChanges(changes);

      expect(results).toHaveLength(2);
      expect(mockDb.insert).toHaveBeenCalledTimes(2);
    });

    it('should return empty array for empty input', async () => {
      const results = await repository.recordItemChanges([]);

      expect(results).toHaveLength(0);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  describe('findUnsyncedChanges', () => {
    it('should return unsynced order and item changes', async () => {
      const mockOrderChange = {
        id: 1,
        orderId: 100,
        changeType: 'created',
        changedFields: null,
        snapshot: JSON.stringify({ externalOrderId: 'EXT-001' }),
        syncedAt: null,
        createdAt: new Date(),
      };

      const mockItemChange = {
        id: 1,
        orderId: 100,
        orderItemId: 10,
        serialNumber: 'SN-001',
        changeType: 'added',
        changedFields: null,
        snapshot: null,
        syncedAt: null,
        createdAt: new Date(),
      };

      mockDb.where
        .mockResolvedValueOnce([mockOrderChange])
        .mockResolvedValueOnce([mockItemChange]);

      const result = await repository.findUnsyncedChanges();

      expect(result.orderChanges).toHaveLength(1);
      expect(result.orderChanges[0].orderId).toBe(100);
      expect(result.itemChanges).toHaveLength(1);
      expect(result.itemChanges[0].serialNumber).toBe('SN-001');
    });

    it('should parse JSON fields in returned changes', async () => {
      const mockOrderChange = {
        id: 1,
        orderId: 100,
        changeType: 'updated',
        changedFields: JSON.stringify({ status: { old: 'pending', new: 'shipped' } }),
        snapshot: JSON.stringify({ externalOrderId: 'EXT-001' }),
        syncedAt: null,
        createdAt: new Date(),
      };

      mockDb.where
        .mockResolvedValueOnce([mockOrderChange])
        .mockResolvedValueOnce([]);

      const result = await repository.findUnsyncedChanges();

      expect(result.orderChanges[0].changedFields).toEqual({
        status: { old: 'pending', new: 'shipped' },
      });
      expect(result.orderChanges[0].snapshot).toEqual({
        externalOrderId: 'EXT-001',
      });
    });
  });

  describe('markOrderChangesSynced', () => {
    it('should update syncedAt for specified change IDs', async () => {
      await repository.markOrderChangesSynced([1, 2, 3]);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          syncedAt: expect.any(Date),
        })
      );
    });

    it('should do nothing for empty array', async () => {
      await repository.markOrderChangesSynced([]);

      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe('markItemChangesSynced', () => {
    it('should update syncedAt for specified item change IDs', async () => {
      await repository.markItemChangesSynced([1, 2]);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          syncedAt: expect.any(Date),
        })
      );
    });

    it('should do nothing for empty array', async () => {
      await repository.markItemChangesSynced([]);

      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe('markOrderFullySynced', () => {
    it('should mark all changes for an order as synced', async () => {
      await repository.markOrderFullySynced(100);

      // Should have called update twice (once for order changes, once for item changes)
      expect(mockDb.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('should throw error when database not set', async () => {
      const newRepository = new OrderChangeRepository();

      await expect(
        newRepository.recordOrderChange({
          orderId: 1,
          changeType: 'created',
        })
      ).rejects.toThrow('Database not set');
    });
  });
});

