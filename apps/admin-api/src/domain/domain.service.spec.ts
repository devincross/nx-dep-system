import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { DomainService } from './domain.service';

// Mock the database module
jest.mock('@org/database', () => ({
  getLandlordDb: jest.fn(),
  domains: { id: 'id', domain: 'domain', tenantId: 'tenantId' },
  tenants: { id: 'id' },
}));

import { getLandlordDb } from '@org/database';

describe('DomainService', () => {
  let service: DomainService;
  let mockDb: any;

  const mockDomain = {
    id: 'domain-uuid-1234',
    tenantId: 'tenant-uuid-1234',
    domain: 'test.example.com',
    isPrimary: true,
    dbHost: 'localhost',
    dbPort: 3306,
    dbName: 'test_db',
    dbUser: 'root',
    dbPassword: 'password',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockTenant = {
    id: 'tenant-uuid-1234',
    name: 'Test Tenant',
    slug: 'test-tenant',
  };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([mockDomain]),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
    };

    (getLandlordDb as jest.Mock).mockReturnValue(mockDb);

    const module: TestingModule = await Test.createTestingModule({
      providers: [DomainService],
    }).compile();

    service = module.get<DomainService>(DomainService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return an array of domains', async () => {
      mockDb.from.mockResolvedValue([mockDomain]);

      const result = await service.findAll();

      expect(result).toEqual([mockDomain]);
    });
  });

  describe('findByTenantId', () => {
    it('should return domains for a tenant', async () => {
      mockDb.where.mockResolvedValue([mockDomain]);

      const result = await service.findByTenantId('tenant-uuid-1234');

      expect(result).toEqual([mockDomain]);
    });
  });

  describe('findOne', () => {
    it('should return a domain when found', async () => {
      mockDb.where.mockResolvedValue([mockDomain]);

      const result = await service.findOne('domain-uuid-1234');

      expect(result).toEqual(mockDomain);
    });

    it('should throw NotFoundException when domain not found', async () => {
      mockDb.where.mockResolvedValue([]);

      await expect(service.findOne('non-existent')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('findByDomainName', () => {
    it('should return a domain when found by name', async () => {
      mockDb.where.mockResolvedValue([mockDomain]);

      const result = await service.findByDomainName('test.example.com');

      expect(result).toEqual(mockDomain);
    });

    it('should throw NotFoundException when domain name not found', async () => {
      mockDb.where.mockResolvedValue([]);

      await expect(service.findByDomainName('not.found.com')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('create', () => {
    it('should create a new domain', async () => {
      mockDb.where
        .mockResolvedValueOnce([mockTenant]) // tenant exists
        .mockResolvedValueOnce([]) // domain doesn't exist
        .mockResolvedValueOnce([mockDomain]); // findOne after insert

      const createDto = {
        tenantId: 'tenant-uuid-1234',
        domain: 'new.example.com',
        dbHost: 'localhost',
        dbName: 'new_db',
        dbUser: 'root',
        dbPassword: 'password',
      };

      const result = await service.create(createDto);

      expect(result).toEqual(mockDomain);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should throw BadRequestException when tenant not found', async () => {
      mockDb.where.mockResolvedValue([]);

      const createDto = {
        tenantId: 'non-existent',
        domain: 'new.example.com',
        dbHost: 'localhost',
        dbName: 'new_db',
        dbUser: 'root',
        dbPassword: 'password',
      };

      await expect(service.create(createDto)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should throw ConflictException when domain exists', async () => {
      mockDb.where
        .mockResolvedValueOnce([mockTenant]) // tenant exists
        .mockResolvedValueOnce([mockDomain]); // domain already exists

      const createDto = {
        tenantId: 'tenant-uuid-1234',
        domain: 'test.example.com',
        dbHost: 'localhost',
        dbName: 'new_db',
        dbUser: 'root',
        dbPassword: 'password',
      };

      await expect(service.create(createDto)).rejects.toThrow(ConflictException);
    });
  });
});

