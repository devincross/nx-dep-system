import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';

// Mock the database module
jest.mock('@org/database', () => ({
  getLandlordDb: jest.fn(),
  landlordUsers: { id: 'id', email: 'email', name: 'name', password: 'password', status: 'status' },
}));

import { getLandlordDb } from '@org/database';

describe('AuthService', () => {
  let service: AuthService;
  let mockDb: any;
  let mockJwtService: { sign: jest.Mock };

  const mockUser = {
    id: 'user-uuid-1234',
    name: 'John Doe',
    email: 'john@example.com',
    password: 'hashedpassword',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUserWithoutPassword = {
    id: 'user-uuid-1234',
    name: 'John Doe',
    email: 'john@example.com',
    status: 'active',
    createdAt: mockUser.createdAt,
    updatedAt: mockUser.updatedAt,
  };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([mockUser]),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
    };

    mockJwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
    };

    (getLandlordDb as jest.Mock).mockReturnValue(mockDb);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return an array of users without passwords', async () => {
      mockDb.from.mockResolvedValue([mockUser]);

      const result = await service.findAll();

      expect(result).toEqual([mockUserWithoutPassword]);
      expect(result[0]).not.toHaveProperty('password');
    });
  });

  describe('findOne', () => {
    it('should return a user without password when found', async () => {
      mockDb.where.mockResolvedValue([mockUser]);

      const result = await service.findOne('user-uuid-1234');

      expect(result).toEqual(mockUserWithoutPassword);
      expect(result).not.toHaveProperty('password');
    });

    it('should throw NotFoundException when user not found', async () => {
      mockDb.where.mockResolvedValue([]);

      await expect(service.findOne('non-existent')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('findByEmail', () => {
    it('should return a user with password when found', async () => {
      mockDb.where.mockResolvedValue([mockUser]);

      const result = await service.findByEmail('john@example.com');

      expect(result).toEqual(mockUser);
      expect(result).toHaveProperty('password');
    });

    it('should return null when email not found', async () => {
      mockDb.where.mockResolvedValue([]);

      const result = await service.findByEmail('notfound@example.com');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a new user', async () => {
      mockDb.where
        .mockResolvedValueOnce([]) // email check
        .mockResolvedValueOnce([mockUser]); // findOne after insert

      const createDto = {
        name: 'John Doe',
        email: 'john@example.com',
        password: 'password123',
      };

      const result = await service.create(createDto);

      expect(result).toEqual(mockUserWithoutPassword);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should throw ConflictException when email exists', async () => {
      mockDb.where.mockResolvedValue([mockUser]);

      const createDto = {
        name: 'John Doe',
        email: 'john@example.com',
        password: 'password123',
      };

      await expect(service.create(createDto)).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('should update an existing user', async () => {
      const updatedUser = { ...mockUser, name: 'John Updated' };
      mockDb.where
        .mockResolvedValueOnce([mockUser]) // exists check
        .mockResolvedValueOnce([updatedUser]); // after update

      mockDb.set.mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });

      const updateDto = { name: 'John Updated' };

      const result = await service.update('user-uuid-1234', updateDto);

      expect(result.name).toBe('John Updated');
    });
  });

  describe('remove', () => {
    it('should remove an existing user', async () => {
      mockDb.where.mockResolvedValue([mockUser]);

      await expect(service.remove('user-uuid-1234')).resolves.not.toThrow();
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should throw NotFoundException when user not found', async () => {
      mockDb.where.mockResolvedValue([]);

      await expect(service.remove('non-existent')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('validateUser', () => {
    it('should return user without password when credentials are valid', async () => {
      // Mock user with correctly hashed password (SHA-256 of 'password123')
      const hashedPassword = require('crypto')
        .createHash('sha256')
        .update('password123')
        .digest('hex');
      const userWithHash = { ...mockUser, password: hashedPassword };
      mockDb.where.mockResolvedValue([userWithHash]);

      const result = await service.validateUser('john@example.com', 'password123');

      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty('password');
      expect(result?.email).toBe('john@example.com');
    });

    it('should return null when user not found', async () => {
      mockDb.where.mockResolvedValue([]);

      const result = await service.validateUser('notfound@example.com', 'password123');

      expect(result).toBeNull();
    });

    it('should return null when password is incorrect', async () => {
      mockDb.where.mockResolvedValue([mockUser]);

      const result = await service.validateUser('john@example.com', 'wrongpassword');

      expect(result).toBeNull();
    });

    it('should return null when user is not active', async () => {
      const hashedPassword = require('crypto')
        .createHash('sha256')
        .update('password123')
        .digest('hex');
      const inactiveUser = { ...mockUser, password: hashedPassword, status: 'inactive' };
      mockDb.where.mockResolvedValue([inactiveUser]);

      const result = await service.validateUser('john@example.com', 'password123');

      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('should return access token and user when credentials are valid', async () => {
      const hashedPassword = require('crypto')
        .createHash('sha256')
        .update('password123')
        .digest('hex');
      const userWithHash = { ...mockUser, password: hashedPassword };
      mockDb.where.mockResolvedValue([userWithHash]);

      const result = await service.login({ email: 'john@example.com', password: 'password123' });

      expect(result.access_token).toBe('mock-jwt-token');
      expect(result.user).not.toHaveProperty('password');
      expect(mockJwtService.sign).toHaveBeenCalledWith({
        sub: mockUser.id,
        email: mockUser.email,
      });
    });

    it('should throw UnauthorizedException when credentials are invalid', async () => {
      mockDb.where.mockResolvedValue([]);

      await expect(
        service.login({ email: 'notfound@example.com', password: 'password123' })
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});

