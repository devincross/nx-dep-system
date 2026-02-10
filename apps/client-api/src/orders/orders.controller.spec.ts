import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

describe('OrdersController', () => {
  let controller: OrdersController;

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
    items: [],
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

  const mockTenantContext = {
    tenant: { id: 'tenant-1', name: 'Test Tenant' },
    domain: { id: 'domain-1', domain: 'test.example.com' },
    db: {},
  };

  const mockOrdersService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    findByAccountId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    createOrderItems: jest.fn(),
    updateOrderItem: jest.fn(),
    removeOrderItem: jest.fn(),
    restoreOrderItem: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        {
          provide: OrdersService,
          useValue: mockOrdersService,
        },
      ],
    }).compile();

    controller = module.get<OrdersController>(OrdersController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return an array of orders', async () => {
      mockOrdersService.findAll.mockResolvedValue([mockOrder]);

      const result = await controller.findAll(mockTenantContext as any);

      expect(result).toEqual([mockOrder]);
      expect(mockOrdersService.findAll).toHaveBeenCalledWith(mockTenantContext.db);
    });
  });

  describe('findOne', () => {
    it('should return an order', async () => {
      mockOrdersService.findOne.mockResolvedValue(mockOrder);

      const result = await controller.findOne(mockTenantContext as any, 1);

      expect(result).toEqual(mockOrder);
      expect(mockOrdersService.findOne).toHaveBeenCalledWith(mockTenantContext.db, 1);
    });

    it('should throw NotFoundException when order not found', async () => {
      mockOrdersService.findOne.mockRejectedValue(
        new NotFoundException('Order not found')
      );

      await expect(controller.findOne(mockTenantContext as any, 999)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('findByAccountId', () => {
    it('should return orders for an account', async () => {
      mockOrdersService.findByAccountId.mockResolvedValue([mockOrder]);

      const result = await controller.findByAccountId(mockTenantContext as any, 1);

      expect(result).toEqual([mockOrder]);
      expect(mockOrdersService.findByAccountId).toHaveBeenCalledWith(mockTenantContext.db, 1);
    });
  });

  describe('create', () => {
    it('should create a new order', async () => {
      const createDto = {
        orderId: '123e4567-e89b-12d3-a456-426614174000',
        accountId: 1,
        status: 'pending' as const,
      };
      mockOrdersService.create.mockResolvedValue(mockOrder);

      const result = await controller.create(mockTenantContext as any, createDto);

      expect(result).toEqual(mockOrder);
      expect(mockOrdersService.create).toHaveBeenCalledWith(mockTenantContext.db, createDto);
    });
  });

  describe('update', () => {
    it('should update an existing order', async () => {
      const updateDto = { status: 'complete' as const };
      const updatedOrder = { ...mockOrder, status: 'complete' };
      mockOrdersService.update.mockResolvedValue(updatedOrder);

      const result = await controller.update(mockTenantContext as any, 1, updateDto);

      expect(result.status).toBe('complete');
      expect(mockOrdersService.update).toHaveBeenCalledWith(mockTenantContext.db, 1, updateDto);
    });
  });

  describe('remove', () => {
    it('should delete an order', async () => {
      mockOrdersService.remove.mockResolvedValue(undefined);

      await expect(controller.remove(mockTenantContext as any, 1)).resolves.not.toThrow();
      expect(mockOrdersService.remove).toHaveBeenCalledWith(mockTenantContext.db, 1);
    });
  });

  describe('addOrderItem', () => {
    it('should add an item to an order', async () => {
      const createItemDto = { serialNumber: 'SN123456', depStatus: 'pending' as const };
      mockOrdersService.createOrderItems.mockResolvedValue([mockOrderItem]);

      const result = await controller.addOrderItem(mockTenantContext as any, 1, createItemDto);

      expect(result).toEqual(mockOrderItem);
    });
  });
});

