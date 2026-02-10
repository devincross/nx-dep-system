import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CredentialsController } from './credentials.controller';
import { CredentialsService } from './credentials.service';

describe('CredentialsController', () => {
  let controller: CredentialsController;
  let service: CredentialsService;

  const mockCredential = {
    id: 1,
    type: 'dep' as const,
    status: 'current' as const,
    connectionData: { key: 'value' },
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockTenantContext = {
    tenant: { id: 'tenant-1', name: 'Test Tenant' },
    domain: { id: 'domain-1', domain: 'test.example.com' },
    db: {},
  };

  const mockCredentialsService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    findByType: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    restore: jest.fn(),
    hardDelete: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CredentialsController],
      providers: [
        {
          provide: CredentialsService,
          useValue: mockCredentialsService,
        },
      ],
    }).compile();

    controller = module.get<CredentialsController>(CredentialsController);
    service = module.get<CredentialsService>(CredentialsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return an array of credentials', async () => {
      mockCredentialsService.findAll.mockResolvedValue([mockCredential]);

      const result = await controller.findAll(mockTenantContext as any);

      expect(result).toEqual([mockCredential]);
      expect(mockCredentialsService.findAll).toHaveBeenCalledWith(
        mockTenantContext.db
      );
    });
  });

  describe('findOne', () => {
    it('should return a credential', async () => {
      mockCredentialsService.findOne.mockResolvedValue(mockCredential);

      const result = await controller.findOne(mockTenantContext as any, 1);

      expect(result).toEqual(mockCredential);
      expect(mockCredentialsService.findOne).toHaveBeenCalledWith(
        mockTenantContext.db,
        1
      );
    });

    it('should throw NotFoundException when credential not found', async () => {
      mockCredentialsService.findOne.mockRejectedValue(
        new NotFoundException('Credential not found')
      );

      await expect(
        controller.findOne(mockTenantContext as any, 999)
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByType', () => {
    it('should return credentials of specified type', async () => {
      mockCredentialsService.findByType.mockResolvedValue([mockCredential]);

      const result = await controller.findByType(
        mockTenantContext as any,
        'dep'
      );

      expect(result).toEqual([mockCredential]);
      expect(mockCredentialsService.findByType).toHaveBeenCalledWith(
        mockTenantContext.db,
        'dep'
      );
    });
  });

  describe('create', () => {
    it('should create a new credential', async () => {
      const createDto = {
        type: 'dep' as const,
        connectionData: { key: 'value' },
      };
      mockCredentialsService.create.mockResolvedValue(mockCredential);

      const result = await controller.create(
        mockTenantContext as any,
        createDto
      );

      expect(result).toEqual(mockCredential);
      expect(mockCredentialsService.create).toHaveBeenCalledWith(
        mockTenantContext.db,
        createDto
      );
    });
  });

  describe('update', () => {
    it('should update an existing credential', async () => {
      const updateDto = { status: 'disabled' as const };
      const updatedCredential = { ...mockCredential, status: 'disabled' };
      mockCredentialsService.update.mockResolvedValue(updatedCredential);

      const result = await controller.update(
        mockTenantContext as any,
        1,
        updateDto
      );

      expect(result.status).toBe('disabled');
      expect(mockCredentialsService.update).toHaveBeenCalledWith(
        mockTenantContext.db,
        1,
        updateDto
      );
    });
  });

  describe('remove', () => {
    it('should soft delete a credential', async () => {
      mockCredentialsService.remove.mockResolvedValue(undefined);

      await expect(
        controller.remove(mockTenantContext as any, 1)
      ).resolves.not.toThrow();
      expect(mockCredentialsService.remove).toHaveBeenCalledWith(
        mockTenantContext.db,
        1
      );
    });
  });
});

