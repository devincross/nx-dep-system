import { Test, TestingModule } from '@nestjs/testing';
import { DomainController } from './domain.controller';
import { DomainService } from './domain.service';

describe('DomainController', () => {
  let controller: DomainController;
  let service: DomainService;

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

  const mockDomainService = {
    findAll: jest.fn().mockResolvedValue([mockDomain]),
    findByTenantId: jest.fn().mockResolvedValue([mockDomain]),
    findOne: jest.fn().mockResolvedValue(mockDomain),
    create: jest.fn().mockResolvedValue(mockDomain),
    update: jest.fn().mockResolvedValue(mockDomain),
    remove: jest.fn().mockResolvedValue(undefined),
    testConnection: jest
      .fn()
      .mockResolvedValue({ success: true, message: 'Connection successful' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DomainController],
      providers: [
        {
          provide: DomainService,
          useValue: mockDomainService,
        },
      ],
    }).compile();

    controller = module.get<DomainController>(DomainController);
    service = module.get<DomainService>(DomainService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return an array of domains', async () => {
      const result = await controller.findAll();

      expect(result).toEqual([mockDomain]);
      expect(service.findAll).toHaveBeenCalled();
    });

    it('should filter by tenantId when provided', async () => {
      const result = await controller.findAll('tenant-uuid-1234');

      expect(result).toEqual([mockDomain]);
      expect(service.findByTenantId).toHaveBeenCalledWith('tenant-uuid-1234');
    });
  });

  describe('findOne', () => {
    it('should return a single domain', async () => {
      const result = await controller.findOne('domain-uuid-1234');

      expect(result).toEqual(mockDomain);
      expect(service.findOne).toHaveBeenCalledWith('domain-uuid-1234');
    });
  });

  describe('create', () => {
    it('should create a domain', async () => {
      const createDto = {
        tenantId: 'tenant-uuid-1234',
        domain: 'new.example.com',
        dbHost: 'localhost',
        dbName: 'new_db',
        dbUser: 'root',
        dbPassword: 'password',
      };

      const result = await controller.create(createDto);

      expect(result).toEqual(mockDomain);
      expect(service.create).toHaveBeenCalledWith(createDto);
    });
  });

  describe('update', () => {
    it('should update a domain', async () => {
      const updateDto = { domain: 'updated.example.com' };

      const result = await controller.update('domain-uuid-1234', updateDto);

      expect(result).toEqual(mockDomain);
      expect(service.update).toHaveBeenCalledWith('domain-uuid-1234', updateDto);
    });
  });

  describe('remove', () => {
    it('should remove a domain', async () => {
      await controller.remove('domain-uuid-1234');

      expect(service.remove).toHaveBeenCalledWith('domain-uuid-1234');
    });
  });

  describe('testConnection', () => {
    it('should test database connection', async () => {
      const result = await controller.testConnection('domain-uuid-1234');

      expect(result).toEqual({ success: true, message: 'Connection successful' });
      expect(service.testConnection).toHaveBeenCalledWith('domain-uuid-1234');
    });
  });
});

