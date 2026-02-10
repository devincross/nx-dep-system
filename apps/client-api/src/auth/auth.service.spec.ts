import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import * as crypto from 'crypto';

describe('AuthService', () => {
  let service: AuthService;
  let mockDb: any;
  let mockJwtService: { sign: jest.Mock };

  const mockUser = {
    id: 'user-uuid-1234',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    passwordHash: 'hashedpassword',
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSafeUser = {
    id: 'user-uuid-1234',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    isActive: true,
    lastLoginAt: null,
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
    };

    mockJwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
    };

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

  describe('findById', () => {
    it('should return a user without passwordHash when found', async () => {
      mockDb.where.mockResolvedValue([mockUser]);

      const result = await service.findById(mockDb, 'user-uuid-1234');

      expect(result).toEqual(mockSafeUser);
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('should throw NotFoundException when user not found', async () => {
      mockDb.where.mockResolvedValue([]);

      await expect(service.findById(mockDb, 'non-existent')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('findByEmail', () => {
    it('should return a user with passwordHash when found', async () => {
      mockDb.where.mockResolvedValue([mockUser]);

      const result = await service.findByEmail(mockDb, 'john@example.com');

      expect(result).toEqual(mockUser);
      expect(result).toHaveProperty('passwordHash');
    });

    it('should return null when email not found', async () => {
      mockDb.where.mockResolvedValue([]);

      const result = await service.findByEmail(mockDb, 'notfound@example.com');

      expect(result).toBeNull();
    });
  });

  describe('register', () => {
    it('should create a new user', async () => {
      mockDb.where
        .mockResolvedValueOnce([]) // email check
        .mockResolvedValueOnce([mockUser]); // findById after insert

      const registerDto = {
        email: 'john@example.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
      };

      const result = await service.register(mockDb, registerDto);

      expect(result).toEqual(mockSafeUser);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should throw ConflictException when email exists', async () => {
      mockDb.where.mockResolvedValue([mockUser]);

      const registerDto = {
        email: 'john@example.com',
        password: 'password123',
      };

      await expect(service.register(mockDb, registerDto)).rejects.toThrow(
        ConflictException
      );
    });
  });

  describe('validateUser', () => {
    it('should return user without passwordHash when credentials are valid', async () => {
      const hashedPassword = crypto
        .createHash('sha256')
        .update('password123')
        .digest('hex');
      const userWithHash = { ...mockUser, passwordHash: hashedPassword };
      mockDb.where.mockResolvedValue([userWithHash]);

      const result = await service.validateUser(mockDb, 'john@example.com', 'password123');

      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty('passwordHash');
      expect(result?.email).toBe('john@example.com');
    });

    it('should return null when user not found', async () => {
      mockDb.where.mockResolvedValue([]);

      const result = await service.validateUser(mockDb, 'notfound@example.com', 'password123');

      expect(result).toBeNull();
    });

    it('should return null when password is incorrect', async () => {
      mockDb.where.mockResolvedValue([mockUser]);

      const result = await service.validateUser(mockDb, 'john@example.com', 'wrongpassword');

      expect(result).toBeNull();
    });

    it('should return null when user is not active', async () => {
      const hashedPassword = crypto
        .createHash('sha256')
        .update('password123')
        .digest('hex');
      const inactiveUser = { ...mockUser, passwordHash: hashedPassword, isActive: false };
      mockDb.where.mockResolvedValue([inactiveUser]);

      const result = await service.validateUser(mockDb, 'john@example.com', 'password123');

      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('should return access token and user when credentials are valid', async () => {
      const hashedPassword = crypto
        .createHash('sha256')
        .update('password123')
        .digest('hex');
      const userWithHash = { ...mockUser, passwordHash: hashedPassword };
      mockDb.where.mockResolvedValue([userWithHash]);

      const result = await service.login(
        mockDb,
        { email: 'john@example.com', password: 'password123' },
        'tenant-uuid-1234'
      );

      expect(result.access_token).toBe('mock-jwt-token');
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(mockJwtService.sign).toHaveBeenCalledWith({
        sub: mockUser.id,
        email: mockUser.email,
        tenantId: 'tenant-uuid-1234',
      });
    });

    it('should throw UnauthorizedException when credentials are invalid', async () => {
      mockDb.where.mockResolvedValue([]);

      await expect(
        service.login(
          mockDb,
          { email: 'notfound@example.com', password: 'password123' },
          'tenant-uuid-1234'
        )
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('updateLastLogin', () => {
    it('should update the last login timestamp', async () => {
      mockDb.set.mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });

      await expect(
        service.updateLastLogin(mockDb, 'user-uuid-1234')
      ).resolves.not.toThrow();

      expect(mockDb.update).toHaveBeenCalled();
    });
  });
});

