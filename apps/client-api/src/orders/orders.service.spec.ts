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

  describe('findAll', () => {
    it('should return an array of orders with items', async () => {
      mockDb.where
        .mockResolvedValueOnce([mockOrder]) // never used - select without where for orders
        .mockResolvedValueOnce([mockOrderItem]);

      // Override select chain for initial order fetch
      mockDb.from.mockReturnValueOnce({
        ...mockDb,
        where: undefined,
      });
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockResolvedValue([mockOrder]),
      });

      // Mock items fetch
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([mockOrderItem]),
        }),
      });

      const result = await service.findAll(mockDb);

      expect(result).toHaveLength(1);
      expect(result[0].items).toBeDefined();
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

