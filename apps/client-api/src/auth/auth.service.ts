import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { TenantDb, users, User } from '@org/database';
import { LoginDto, RegisterDto } from './dto/index.js';
import * as crypto from 'crypto';

// User without password hash
export type SafeUser = Omit<User, 'passwordHash'>;

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  private hashPassword(password: string): string {
    // Using SHA-256 for password hashing
    // In production, consider using bcrypt or argon2
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  async findById(db: TenantDb, id: string): Promise<SafeUser> {
    const result = await db.select().from(users).where(eq(users.id, id));

    if (result.length === 0) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    const { passwordHash, ...user } = result[0];
    return user;
  }

  async findByEmail(db: TenantDb, email: string): Promise<User | null> {
    const result = await db.select().from(users).where(eq(users.email, email));
    return result.length > 0 ? result[0] : null;
  }

  async register(db: TenantDb, registerDto: RegisterDto): Promise<SafeUser> {
    // Check if email already exists
    const existing = await this.findByEmail(db, registerDto.email);

    if (existing) {
      throw new ConflictException(
        `User with email "${registerDto.email}" already exists`
      );
    }

    const id = uuidv4();
    const now = new Date();

    await db.insert(users).values({
      id,
      email: registerDto.email,
      firstName: registerDto.firstName || null,
      lastName: registerDto.lastName || null,
      passwordHash: this.hashPassword(registerDto.password),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    return this.findById(db, id);
  }

  async validateUser(
    db: TenantDb,
    email: string,
    password: string
  ): Promise<SafeUser | null> {
    const user = await this.findByEmail(db, email);

    if (!user) {
      return null;
    }

    const hashedPassword = this.hashPassword(password);
    if (user.passwordHash !== hashedPassword) {
      return null;
    }

    // Check if user is active
    if (!user.isActive) {
      return null;
    }

    const { passwordHash, ...result } = user;
    return result;
  }

  async login(
    db: TenantDb,
    loginDto: LoginDto,
    tenantId: string
  ): Promise<{ access_token: string; user: SafeUser }> {
    const user = await this.validateUser(db, loginDto.email, loginDto.password);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Include tenantId in the JWT payload for multi-tenant support
    const payload = { sub: user.id, email: user.email, tenantId };

    return {
      access_token: this.jwtService.sign(payload),
      user,
    };
  }

  async updateLastLogin(db: TenantDb, userId: string): Promise<void> {
    await db
      .update(users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId));
  }
}

