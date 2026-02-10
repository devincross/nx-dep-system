import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CredentialsService } from './credentials.service';
import { EncryptionService } from '../encryption/encryption.service';

// Mock the database module
jest.mock('@org/database', () => ({
  credentials: {
    id: 'id',
    type: 'type',
    status: 'status',
    connectionData: 'connectionData',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    deletedAt: 'deletedAt',
  },
}));

describe('CredentialsService', () => {
  let service: CredentialsService;
  let mockDb: any;
  let mockEncryptionService: jest.Mocked<EncryptionService>;

  const connectionDataPlain = { key: 'value' };
  const connectionDataEncrypted = 'v1:iv:authTag:ciphertext';

  // Database stores encrypted data
  const mockDbCredential = {
    id: 1,
    type: 'dep' as const,
    status: 'current' as const,
    connectionData: connectionDataEncrypted,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  // API returns decrypted data
  const mockDecryptedCredential = {
    ...mockDbCredential,
    connectionData: connectionDataPlain,
  };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([mockDbCredential]),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockResolvedValue([{ insertId: BigInt(1) }]),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
    };

    mockEncryptionService = {
      encrypt: jest.fn().mockReturnValue(connectionDataEncrypted),
      decrypt: jest.fn().mockReturnValue(JSON.stringify(connectionDataPlain)),
      encryptJson: jest.fn().mockReturnValue(connectionDataEncrypted),
      decryptJson: jest.fn().mockReturnValue(connectionDataPlain),
      getCurrentVersion: jest.fn().mockReturnValue('v1'),
      onModuleInit: jest.fn(),
    } as unknown as jest.Mocked<EncryptionService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialsService,
        {
          provide: EncryptionService,
          useValue: mockEncryptionService,
        },
      ],
    }).compile();

    service = module.get<CredentialsService>(CredentialsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return an array of decrypted credentials', async () => {
      mockDb.where.mockResolvedValue([mockDbCredential]);

      const result = await service.findAll(mockDb);

      expect(result).toEqual([mockDecryptedCredential]);
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.from).toHaveBeenCalled();
      expect(mockEncryptionService.decryptJson).toHaveBeenCalledWith(
        connectionDataEncrypted
      );
    });
  });

  describe('findOne', () => {
    it('should return a decrypted credential when found', async () => {
      mockDb.where.mockResolvedValue([mockDbCredential]);

      const result = await service.findOne(mockDb, 1);

      expect(result).toEqual(mockDecryptedCredential);
      expect(mockEncryptionService.decryptJson).toHaveBeenCalledWith(
        connectionDataEncrypted
      );
    });

    it('should throw NotFoundException when credential not found', async () => {
      mockDb.where.mockResolvedValue([]);

      await expect(service.findOne(mockDb, 999)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('findByType', () => {
    it('should return decrypted credentials of specified type', async () => {
      mockDb.where.mockResolvedValue([mockDbCredential]);

      const result = await service.findByType(mockDb, 'dep');

      expect(result).toEqual([mockDecryptedCredential]);
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockEncryptionService.decryptJson).toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should encrypt connectionData and create a new credential', async () => {
      mockDb.values.mockResolvedValue([{ insertId: BigInt(1) }]);
      mockDb.where.mockResolvedValue([mockDbCredential]);

      const createDto = {
        type: 'dep' as const,
        connectionData: connectionDataPlain,
      };

      const result = await service.create(mockDb, createDto);

      expect(result).toEqual(mockDecryptedCredential);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockEncryptionService.encryptJson).toHaveBeenCalledWith(
        connectionDataPlain
      );
    });
  });

  describe('update', () => {
    it('should encrypt connectionData when updating', async () => {
      const updatedDbCredential = {
        ...mockDbCredential,
        status: 'disabled' as const,
      };
      const updatedDecryptedCredential = {
        ...updatedDbCredential,
        connectionData: connectionDataPlain,
      };

      // Mock the chained update().set().where() call
      mockDb.set.mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });

      mockDb.where
        .mockResolvedValueOnce([mockDbCredential]) // findOne check (exists)
        .mockResolvedValueOnce([updatedDbCredential]); // findOne after update

      const updateDto = { status: 'disabled' as const };

      const result = await service.update(mockDb, 1, updateDto);

      expect(result.status).toBe('disabled');
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should encrypt connectionData when provided in update', async () => {
      const newConnectionData = { newKey: 'newValue' };

      mockDb.set.mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });

      mockDb.where
        .mockResolvedValueOnce([mockDbCredential])
        .mockResolvedValueOnce([mockDbCredential]);

      const updateDto = { connectionData: newConnectionData };

      await service.update(mockDb, 1, updateDto);

      expect(mockEncryptionService.encryptJson).toHaveBeenCalledWith(
        newConnectionData
      );
    });

    it('should throw NotFoundException when credential not found', async () => {
      mockDb.where.mockResolvedValue([]);

      await expect(
        service.update(mockDb, 999, { status: 'disabled' })
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should soft delete an existing credential', async () => {
      mockDb.where.mockResolvedValue([mockDbCredential]);

      await expect(service.remove(mockDb, 1)).resolves.not.toThrow();
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException when credential not found', async () => {
      mockDb.where.mockResolvedValue([]);

      await expect(service.remove(mockDb, 999)).rejects.toThrow(
        NotFoundException
      );
    });
  });
});

