import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { TenantDb, users, User } from '@org/database';
import { hashPassword } from '../auth/password.util.js';
import { CreateUserDto, UpdateUserDto, UpdateMeDto } from './dto/index.js';

// User without password hash — never return the hash to clients
export type SafeUser = Omit<User, 'passwordHash'>;

function toSafeUser(user: User): SafeUser {
  const { passwordHash, ...safe } = user;
  return safe;
}

@Injectable()
export class UserService {
  async findAll(db: TenantDb): Promise<SafeUser[]> {
    const rows = await db.select().from(users);
    return rows.map(toSafeUser);
  }

  async findOne(db: TenantDb, id: string): Promise<SafeUser> {
    const result = await db.select().from(users).where(eq(users.id, id));

    if (result.length === 0) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    return toSafeUser(result[0]);
  }

  async findByEmail(db: TenantDb, email: string): Promise<User | null> {
    const result = await db.select().from(users).where(eq(users.email, email));
    return result.length > 0 ? result[0] : null;
  }

  async create(db: TenantDb, createUserDto: CreateUserDto): Promise<SafeUser> {
    const existing = await this.findByEmail(db, createUserDto.email);
    if (existing) {
      throw new ConflictException(`User with email "${createUserDto.email}" already exists`);
    }

    const id = uuidv4();
    const now = new Date();

    await db.insert(users).values({
      id,
      email: createUserDto.email,
      firstName: createUserDto.firstName,
      lastName: createUserDto.lastName,
      passwordHash: hashPassword(createUserDto.password),
      role: createUserDto.role ?? 'user',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    return this.findOne(db, id);
  }

  async update(
    db: TenantDb,
    id: string,
    updateUserDto: UpdateUserDto,
    actingUserId: string,
  ): Promise<SafeUser> {
    // Ensure user exists
    await this.findOne(db, id);

    // An admin cannot demote or deactivate their own account — prevents
    // locking the tenant out of user management entirely
    if (id === actingUserId) {
      if (updateUserDto.role === 'user') {
        throw new BadRequestException('You cannot change your own role');
      }
      if (updateUserDto.isActive === false) {
        throw new BadRequestException('You cannot deactivate your own account');
      }
    }

    if (updateUserDto.email) {
      const existing = await this.findByEmail(db, updateUserDto.email);
      if (existing && existing.id !== id) {
        throw new ConflictException(`User with email "${updateUserDto.email}" already exists`);
      }
    }

    const { password, ...fields } = updateUserDto;
    await db
      .update(users)
      .set({
        ...fields,
        ...(password ? { passwordHash: hashPassword(password) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));

    return this.findOne(db, id);
  }

  /**
   * Self-service update: name, email, password only — never role or isActive.
   */
  async updateMe(db: TenantDb, userId: string, dto: UpdateMeDto): Promise<SafeUser> {
    if (dto.email) {
      const existing = await this.findByEmail(db, dto.email);
      if (existing && existing.id !== userId) {
        throw new ConflictException(`User with email "${dto.email}" already exists`);
      }
    }

    const { password, ...fields } = dto;
    await db
      .update(users)
      .set({
        ...fields,
        ...(password ? { passwordHash: hashPassword(password) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return this.findOne(db, userId);
  }

  async remove(db: TenantDb, id: string, actingUserId: string): Promise<void> {
    if (id === actingUserId) {
      throw new BadRequestException('You cannot delete your own account');
    }

    // Ensure user exists
    await this.findOne(db, id);

    await db.delete(users).where(eq(users.id, id));
  }
}
