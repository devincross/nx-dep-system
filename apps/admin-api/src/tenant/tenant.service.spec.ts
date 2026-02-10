import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { TenantService } from './tenant.service';

// Mock the database module
jest.mock('@org/database', () => ({
  getLandlordDb: jest.fn(),
  tenants: { id: 'id', slug: 'slug', name: 'name' },
}));

import { getLandlordDb } from '@org/database';

describe('TenantService', () => {
  let service: TenantService;
  let mockDb: any;

  const mockTenant = {
    id: 'test-uuid-1234',
    name: 'Test Tenant',
    slug: 'test-tenant',
    isActive: true,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    // Create mock database with chainable query builder
    mockDb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([mockTenant]),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
    };

    (getLandlordDb as jest.Mock).mockReturnValue(mockDb);

    const module: TestingModule = await Test.createTestingModule({
      providers: [TenantService],
    }).compile();

    service = module.get<TenantService>(TenantService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return an array of tenants', async () => {
      mockDb.from.mockResolvedValue([mockTenant]);

      const result = await service.findAll();

      expect(result).toEqual([mockTenant]);
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.from).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a tenant when found', async () => {
      mockDb.where.mockResolvedValue([mockTenant]);

      const result = await service.findOne('test-uuid-1234');

      expect(result).toEqual(mockTenant);
    });

    it('should throw NotFoundException when tenant not found', async () => {
      mockDb.where.mockResolvedValue([]);

      await expect(service.findOne('non-existent')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('findBySlug', () => {
    it('should return a tenant when found by slug', async () => {
      mockDb.where.mockResolvedValue([mockTenant]);

      const result = await service.findBySlug('test-tenant');

      expect(result).toEqual(mockTenant);
    });

    it('should throw NotFoundException when slug not found', async () => {
      mockDb.where.mockResolvedValue([]);

      await expect(service.findBySlug('non-existent')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('create', () => {
    it('should create a new tenant', async () => {
      // First call for checking existing slug - return empty
      // Second call for findOne after insert - return the tenant
      mockDb.where
        .mockResolvedValueOnce([]) // slug check
        .mockResolvedValueOnce([mockTenant]); // findOne after insert

      const createDto = {
        name: 'Test Tenant',
        slug: 'test-tenant',
      };

      const result = await service.create(createDto);

      expect(result).toEqual(mockTenant);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should throw ConflictException when slug exists', async () => {
      mockDb.where.mockResolvedValue([mockTenant]);

      const createDto = {
        name: 'Test Tenant',
        slug: 'test-tenant',
      };

      await expect(service.create(createDto)).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('should update an existing tenant', async () => {
      const updatedTenant = { ...mockTenant, name: 'Updated' };
      // First call for findOne (exists check)
      // Second call for slug uniqueness check
      // Third call for findOne after update
      mockDb.where
        .mockResolvedValueOnce([mockTenant]) // exists check
        .mockResolvedValueOnce([]) // slug uniqueness (empty = unique)
        .mockResolvedValueOnce([updatedTenant]); // after update

      // Make set().where() return a resolved promise
      mockDb.set.mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });

      const updateDto = { name: 'Updated', slug: 'new-slug' };

      const result = await service.update('test-uuid-1234', updateDto);

      expect(result.name).toBe('Updated');
    });
  });

  describe('remove', () => {
    it('should remove an existing tenant', async () => {
      mockDb.where.mockResolvedValue([mockTenant]);

      await expect(service.remove('test-uuid-1234')).resolves.not.toThrow();
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should throw NotFoundException when tenant not found', async () => {
      mockDb.where.mockResolvedValue([]);

      await expect(service.remove('non-existent')).rejects.toThrow(
        NotFoundException
      );
    });
  });
});

