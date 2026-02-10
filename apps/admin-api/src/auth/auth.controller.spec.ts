import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let service: AuthService;

  const mockUser = {
    id: 'user-uuid-1234',
    name: 'John Doe',
    email: 'john@example.com',
    status: 'active' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockLoginResponse = {
    access_token: 'mock-jwt-token',
    user: mockUser,
  };

  const mockAuthService = {
    findAll: jest.fn().mockResolvedValue([mockUser]),
    findOne: jest.fn().mockResolvedValue(mockUser),
    create: jest.fn().mockResolvedValue(mockUser),
    update: jest.fn().mockResolvedValue(mockUser),
    remove: jest.fn().mockResolvedValue(undefined),
    login: jest.fn().mockResolvedValue(mockLoginResponse),
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

  describe('findAll', () => {
    it('should return an array of users', async () => {
      const result = await controller.findAll();

      expect(result).toEqual([mockUser]);
      expect(service.findAll).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a single user', async () => {
      const result = await controller.findOne('user-uuid-1234');

      expect(result).toEqual(mockUser);
      expect(service.findOne).toHaveBeenCalledWith('user-uuid-1234');
    });
  });

  describe('create', () => {
    it('should create a user', async () => {
      const createDto = {
        name: 'John Doe',
        email: 'john@example.com',
        password: 'password123',
      };

      const result = await controller.create(createDto);

      expect(result).toEqual(mockUser);
      expect(service.create).toHaveBeenCalledWith(createDto);
    });
  });

  describe('update', () => {
    it('should update a user', async () => {
      const updateDto = { name: 'John Updated' };

      const result = await controller.update('user-uuid-1234', updateDto);

      expect(result).toEqual(mockUser);
      expect(service.update).toHaveBeenCalledWith('user-uuid-1234', updateDto);
    });
  });

  describe('remove', () => {
    it('should remove a user', async () => {
      await controller.remove('user-uuid-1234');

      expect(service.remove).toHaveBeenCalledWith('user-uuid-1234');
    });
  });

  describe('login', () => {
    it('should return access token and user', async () => {
      const loginDto = {
        email: 'john@example.com',
        password: 'password123',
      };

      const result = await controller.login(loginDto);

      expect(result).toEqual(mockLoginResponse);
      expect(service.login).toHaveBeenCalledWith(loginDto);
    });
  });

  describe('register', () => {
    it('should register a new user', async () => {
      const createDto = {
        name: 'John Doe',
        email: 'john@example.com',
        password: 'password123',
      };

      const result = await controller.register(createDto);

      expect(result).toEqual(mockUser);
      expect(service.create).toHaveBeenCalledWith(createDto);
    });
  });
});

