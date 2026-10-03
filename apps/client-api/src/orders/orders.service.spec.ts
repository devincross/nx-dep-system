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
  orderItemChanges: { id: 'id', orderId: 'orderId', changeType: 'changeType', syncedAt: 'syncedAt', createdAt: 'createdAt' },
  orderChanges: { id: 'id', orderId: 'orderId', syncedAt: 'syncedAt', createdAt: 'createdAt' },
  accounts: { id: 'id' },
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

  describe('findNeedingAttention', () => {
    const now = new Date('2026-01-02T00:00:00Z');
    const old = new Date('2026-01-01T00:00:00Z');
    const q = (rows: any[]) => {
      const p: any = Promise.resolve(rows);
      p.limit = () => Promise.resolve(rows);
      p.orderBy = () => Promise.resolve(rows);
      return { from: () => ({ where: () => p }) };
    };

    it('explains error orders, missing Apple org IDs, unsynced changes and stuck transactions', async () => {
      const order = (id: number, accountId: number, status = 'waiting') => ({
        id, accountId, status, externalOrderId: `EXT-${id}`, updatedAt: old,
      });
      mockDb.select
        .mockReturnValueOnce(q([order(1, 10, 'error')])) // error orders
        .mockReturnValueOnce(q([{ orderId: 2, createdAt: old }])) // order changes
        .mockReturnValueOnce(q([{ orderId: 3, createdAt: old }])) // item changes
        .mockReturnValueOnce(q([{ orderId: 4, orderType: 'RE', createdAt: old }])) // stuck txns
        .mockReturnValueOnce(q([order(1, 10, 'error'), order(2, 11), order(3, 10), order(4, 10)])) // orders
        .mockReturnValueOnce(q([{ id: 10, depAccountId: 'DEP1' }, { id: 11, depAccountId: null, name: 'Acme' }])) // accounts
        .mockReturnValueOnce(q([{ orderId: 1, errorMessage: 'Bad customer', status: 'error' }])); // error txns

      const issues = await service.findNeedingAttention(mockDb, now);

      expect(issues.map((i) => [i.orderId, i.type])).toEqual(
        expect.arrayContaining([
          [1, 'order_error'],
          [2, 'missing_dep_account'],
          [3, 'unsynced_changes'],
          [4, 'stuck_transaction'],
        ]),
      );
      expect(issues).toHaveLength(4);
      expect(issues.find((i) => i.orderId === 1)?.message).toBe('Bad customer');
      expect(issues.find((i) => i.orderId === 2)?.message).toContain('Acme');
    });

    it('returns nothing when everything is healthy', async () => {
      mockDb.select
        .mockReturnValueOnce(q([]))
        .mockReturnValueOnce(q([]))
        .mockReturnValueOnce(q([]))
        .mockReturnValueOnce(q([]));
      expect(await service.findNeedingAttention(mockDb, now)).toEqual([]);
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


  describe('change recording for DEP enrollment', () => {
    const tables = jest.requireMock('@org/database');
    const sel = (rows: any[]) => ({ from: () => ({ where: () => Promise.resolve(rows) }) });
    let inserted: { table: unknown; values: any }[];

    beforeEach(() => {
      inserted = [];
      mockDb.insert.mockImplementation((table: unknown) => ({
        values: (values: any) => {
          inserted.push({ table, values });
          return Promise.resolve([{ insertId: BigInt(inserted.length) }]);
        },
      }));
    });

    const changeRows = (table: unknown) => inserted.filter((i) => i.table === table).flatMap((i) => i.values);

    it('records one created change and added item changes when an order is created in the portal', async () => {
      mockDb.select
        .mockReturnValueOnce(sel([])) // serial uniqueness
        .mockReturnValueOnce(sel([mockOrderItem])) // items after insert
        .mockReturnValueOnce(sel([mockOrderItem])) // items to record
        .mockReturnValueOnce(sel([mockOrder])) // findOne order
        .mockReturnValueOnce(sel([mockOrderItem])); // findOne items

      await service.create(mockDb, {
        orderId: mockOrder.orderId, accountId: 1, status: 'waiting' as const,
        items: [{ serialNumber: 'SN123456', isDep: true, depStatus: 'pending' as const }],
      });

      expect(changeRows(tables.orderChanges)).toEqual([expect.objectContaining({ changeType: 'created' })]);
      // exactly one 'added' row — createOrderItems must not double-record
      expect(changeRows(tables.orderItemChanges)).toEqual([
        expect.objectContaining({ changeType: 'added', serialNumber: 'SN123456' }),
      ]);
    });

    it('records an added change for devices added to an existing order', async () => {
      // insert ids are 1-based by call order, so the new item gets id 1
      mockDb.select
        .mockReturnValueOnce(sel([])) // serial uniqueness
        .mockReturnValueOnce(sel([{ ...mockOrderItem, id: 1, serialNumber: 'NEW1' }]));

      await service.createOrderItems(mockDb, 1, [{ serialNumber: 'NEW1', isDep: true, depStatus: 'pending' as const }]);

      expect(changeRows(tables.orderChanges)).toEqual([]);
      expect(changeRows(tables.orderItemChanges)).toEqual([
        expect.objectContaining({ orderItemId: 1, serialNumber: 'NEW1', changeType: 'added' }),
      ]);
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
            where: jest.fn().mockResolvedValue([mockOrderItem]), // Items to record as added
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

