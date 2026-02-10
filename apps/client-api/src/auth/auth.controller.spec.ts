import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TenantContext } from '../tenant/tenant-context.service';

describe('AuthController', () => {
  let controller: AuthController;
  let service: AuthService;

  const mockUser = {
    id: 'user-uuid-1234',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockLoginResponse = {
    access_token: 'mock-jwt-token',
    user: mockUser,
  };

  const mockTenantContext: TenantContext = {
    tenant: {
      id: 'tenant-uuid-1234',
      name: 'Test Tenant',
      slug: 'test-tenant',
      isActive: true,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    domain: {
      id: 'domain-uuid-1234',
      tenantId: 'tenant-uuid-1234',
      domain: 'test.example.com',
      isPrimary: true,
      dbHost: 'localhost',
      dbPort: 3306,
      dbName: 'test_db',
      dbUser: 'test_user',
      dbPassword: 'test_password',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    db: {} as any,
  };

  const mockAuthService = {
    findById: jest.fn().mockResolvedValue(mockUser),
    register: jest.fn().mockResolvedValue(mockUser),
    login: jest.fn().mockResolvedValue(mockLoginResponse),
    updateLastLogin: jest.fn().mockResolvedValue(undefined),
    jwtService: {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('login', () => {
    it('should return access token and user', async () => {
      const loginDto = {
        email: 'john@example.com',
        password: 'password123',
      };

      const result = await controller.login(mockTenantContext, loginDto);

      expect(result).toEqual(mockLoginResponse);
      expect(service.login).toHaveBeenCalledWith(
        mockTenantContext.db,
        loginDto,
        mockTenantContext.tenant.id
      );
      expect(service.updateLastLogin).toHaveBeenCalledWith(
        mockTenantContext.db,
        mockUser.id
      );
    });
  });

  describe('register', () => {
    it('should register a new user and return token', async () => {
      const registerDto = {
        email: 'john@example.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
      };

      const result = await controller.register(mockTenantContext, registerDto);

      expect(result.user).toEqual(mockUser);
      expect(result.access_token).toBe('mock-jwt-token');
      expect(service.register).toHaveBeenCalledWith(
        mockTenantContext.db,
        registerDto
      );
    });
  });

  describe('getProfile', () => {
    it('should return current user', async () => {
      const result = await controller.getProfile(mockUser);

      expect(result).toEqual(mockUser);
    });
  });

  describe('validateToken', () => {
    it('should return valid status and user', async () => {
      const result = await controller.validateToken(mockUser);

      expect(result).toEqual({ valid: true, user: mockUser });
    });
  });
});

