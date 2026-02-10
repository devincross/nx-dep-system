import { Test, TestingModule } from '@nestjs/testing';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

describe('TenantController', () => {
  let controller: TenantController;
  let service: TenantService;

  const mockTenant = {
    id: 'test-uuid-1234',
    name: 'Test Tenant',
    slug: 'test-tenant',
    isActive: true,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockTenantService = {
    findAll: jest.fn().mockResolvedValue([mockTenant]),
    findOne: jest.fn().mockResolvedValue(mockTenant),
    create: jest.fn().mockResolvedValue(mockTenant),
    update: jest.fn().mockResolvedValue(mockTenant),
    remove: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenantController],
      providers: [
        {
          provide: TenantService,
          useValue: mockTenantService,
        },
      ],
    }).compile();

    controller = module.get<TenantController>(TenantController);
    service = module.get<TenantService>(TenantService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return an array of tenants', async () => {
      const result = await controller.findAll();

      expect(result).toEqual([mockTenant]);
      expect(service.findAll).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a single tenant', async () => {
      const result = await controller.findOne('test-uuid-1234');

      expect(result).toEqual(mockTenant);
      expect(service.findOne).toHaveBeenCalledWith('test-uuid-1234');
    });
  });

  describe('create', () => {
    it('should create a tenant', async () => {
      const createDto = { name: 'Test Tenant', slug: 'test-tenant' };

      const result = await controller.create(createDto);

      expect(result).toEqual(mockTenant);
      expect(service.create).toHaveBeenCalledWith(createDto);
    });
  });

  describe('update', () => {
    it('should update a tenant', async () => {
      const updateDto = { name: 'Updated Tenant' };

      const result = await controller.update('test-uuid-1234', updateDto);

      expect(result).toEqual(mockTenant);
      expect(service.update).toHaveBeenCalledWith('test-uuid-1234', updateDto);
    });
  });

  describe('remove', () => {
    it('should remove a tenant', async () => {
      await controller.remove('test-uuid-1234');

      expect(service.remove).toHaveBeenCalledWith('test-uuid-1234');
    });
  });
});

