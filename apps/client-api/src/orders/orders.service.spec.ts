import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';

// Mock the database module
jest.mock('@org/database', () => ({
  orders: {
    id: 'id',
    orderId: 'orderId',
    accountId: 'accountId',
    externalOrderId: 'externalOrderId',
    status: 'status',
  },
  orderItems: {
    id: 'id',
    orderId: 'orderId',
    serialNumber: 'serialNumber',
    depStatus: 'depStatus',
    deletedAt: 'deletedAt',
  },
  orderItemChanges: { id: 'id', orderId: 'orderId', changeType: 'changeType' },
  orderChanges: { id: 'id', orderId: 'orderId' },
  depTransactions: { id: 'id', orderId: 'orderId', orderType: 'orderType' },
}));

describe('OrdersService', () => {
  let service: OrdersService;
  let mockDb: any;

  const mockOrder = {
    id: 1,
    orderId: '123e4567-e89b-12d3-a456-426614174000',
    accountId: 1,
    externalOrderId: 'EXT-001',
    externalAccountId: 'EXT-ACC-001',
    externalOrderStatus: 'new',
    status: 'pending' as const,
    po: 'PO-001',
    changes: null,
    depOrderId: null,
    depOrderedAt: null,
    depShippedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    source: 'zoho',
  };

  const mockOrderItem = {
    id: 1,
    orderId: 1,
    isDep: true,
    serialNumber: 'SN123456',
    depStatus: 'pending' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockOrderWithItems = {
    ...mockOrder,
    items: [mockOrderItem],
  };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([mockOrder]),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockResolvedValue([{ insertId: BigInt(1) }]),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [OrdersService],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findPage', () => {
    it('should return a page of orders with items and a total count', async () => {
      // Count query
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ total: 1 }]),
        }),
      });
      // Page query
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                offset: jest.fn().mockResolvedValue([mockOrder]),
              }),
            }),
          }),
        }),
      });
      // Items query for the page
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([mockOrderItem]),
        }),
      });

      const result = await service.findPage(mockDb, { page: 1, limit: 25 });

      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].items).toEqual([mockOrderItem]);
    });
  });

  describe('findOne', () => {
    it('should return an order with items when found', async () => {
      // Order fetch
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([mockOrder]),
        }),
      });

      // Items fetch
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([mockOrderItem]),
        }),
      });

      const result = await service.findOne(mockDb, 1);

      expect(result).toEqual(mockOrderWithItems);
    });

    it('should throw NotFoundException when order not found', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });

      await expect(service.findOne(mockDb, 999)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('getActivity', () => {
    const t = (m: number) => new Date(Date.UTC(2026, 0, 1, 0, m));
    const chain = (rows: any[]) => ({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(rows) }) }) }),
    });

    it('merges changes and transactions newest-first with push state', async () => {
      // findOne: order, then its items
      mockDb.select
        .mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve([mockOrder]) }) })
        .mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve([]) }) })
        .mockReturnValueOnce(chain([{ changeType: 'updated', changedFields: '{"po":{},"status":{}}', syncedAt: null, createdAt: t(10) }]))
        .mockReturnValueOnce(chain([{ changeType: 'removed', serialNumber: 'SN1', syncedAt: t(12), createdAt: t(5) }]))
        .mockReturnValueOnce(chain([{ orderType: 'RE', status: 'error', errorMessage: 'Bad serial', createdAt: t(20) }]));

      const result = await service.getActivity(mockDb, 1);

      expect(result.map((e) => e.title)).toEqual([
        'Return submitted to Apple',
        'Order updated',
        'Device removed: SN1',
      ]);
      expect(result[0]).toMatchObject({ state: 'error', detail: 'Bad serial' });
      expect(result[1]).toMatchObject({ state: 'waiting', detail: 'Changed: po, status' });
      expect(result[2]).toMatchObject({ state: 'sent' });
    });
  });

  describe('findReturnedItems', () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const t1 = new Date('2026-01-01T01:00:00Z');
    const returned = (id: number, serialNumber: string) => ({
      ...mockOrderItem, id, serialNumber, deletedAt: t0,
    });
    const change = (orderItemId: number, serialNumber: string, snapshot: object, syncedAt: Date | null) => ({
      orderItemId, serialNumber, snapshot: JSON.stringify(snapshot), syncedAt, createdAt: t0,
    });
    const enrolled = { isDep: true, depStatus: 'complete' };

    function mockQueries(items: any[], changes: any[], txns: any[]) {
      const plain = (rows: any[]) => ({ from: () => ({ where: () => Promise.resolve(rows) }) });
      const ordered = (rows: any[]) => ({
        from: () => ({ where: () => ({ orderBy: () => Promise.resolve(rows) }) }),
      });
      mockDb.select
        .mockReturnValueOnce(plain(items))
        .mockReturnValueOnce(ordered(changes))
        .mockReturnValueOnce(ordered(txns));
    }

    it('derives the return status of each returned device', async () => {
      mockQueries(
        [returned(1, 'A'), returned(2, 'B'), returned(3, 'C'), returned(4, 'D'), returned(5, 'E'), returned(6, 'F')],
        [
          change(1, 'A', enrolled, null),
          change(2, 'B', enrolled, t1),
          change(3, 'C', enrolled, t1),
          change(4, 'D', enrolled, t1),
          change(5, 'E', { isDep: true, depStatus: 'pending' }, t1),
        ],
        [
          { status: 'complete', createdAt: t1, requestPayload: '{"deviceId":"B"}' },
          { status: 'error', createdAt: t1, requestPayload: '{"deviceId":"C"}' },
          { status: 'in_progress', createdAt: t1, requestPayload: '{"deviceId":"D"}' },
        ],
      );

      const result = await service.findReturnedItems(mockDb, 1);

      expect(result.map((r) => r.returnStatus)).toEqual([
        'pending', 'complete', 'error', 'submitted', 'removed', 'removed',
      ]);
    });

    it('returns nothing without querying changes when no items were returned', async () => {
      mockQueries([], [], []);
      expect(await service.findReturnedItems(mockDb, 1)).toEqual([]);
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });
  });

  describe('create', () => {
    it('should create a new order with items', async () => {
      // Insert order
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockResolvedValue([{ insertId: BigInt(1) }]),
      });

      // Mock select calls in sequence:
      // 1. validateSerialNumbersUnique - returns empty (no duplicates)
      // 2. createOrderItems - returns created items
      // 3. findOne - returns order
      // 4. findOne - returns items
      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]), // No duplicate serial numbers
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mockOrderItem]), // Created items
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mockOrder]), // findOne order
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mockOrderItem]), // findOne items
          }),
        });

      const createDto = {
        orderId: '123e4567-e89b-12d3-a456-426614174000',
        accountId: 1,
        status: 'pending' as const,
        items: [{ serialNumber: 'SN123456', depStatus: 'pending' as const }],
      };

      const result = await service.create(mockDb, createDto);
      expect(result).toBeDefined();
    });
  });
});

