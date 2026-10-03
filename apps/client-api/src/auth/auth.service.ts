import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { TenantDb, users, User } from '@org/database';
import { LoginDto } from './dto/index.js';
import { hashPassword } from './password.util.js';

// User without password hash
export type SafeUser = Omit<User, 'passwordHash'>;

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

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

  async validateUser(
    db: TenantDb,
    email: string,
    password: string
  ): Promise<SafeUser | null> {
    const user = await this.findByEmail(db, email);

    if (!user) {
      return null;
    }

    const hashedPassword = hashPassword(password);
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

