import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { TenantDb, users, User } from '@org/database';
import { CreateUserDto, UpdateUserDto } from './dto/index.js';

@Injectable()
export class UserService {
  async findAll(db: TenantDb): Promise<User[]> {
    return db.select().from(users);
  }

  async findOne(db: TenantDb, id: string): Promise<User> {
    const result = await db.select().from(users).where(eq(users.id, id));

    if (result.length === 0) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    return result[0];
  }

  async findByEmail(db: TenantDb, email: string): Promise<User | null> {
    const result = await db.select().from(users).where(eq(users.email, email));
    return result.length > 0 ? result[0] : null;
  }

  async create(db: TenantDb, createUserDto: CreateUserDto): Promise<User> {
    const id = uuidv4();
    const now = new Date();

    await db.insert(users).values({
      id,
      email: createUserDto.email,
      firstName: createUserDto.firstName,
      lastName: createUserDto.lastName,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    return this.findOne(db, id);
  }

  async update(
    db: TenantDb,
    id: string,
    updateUserDto: UpdateUserDto
  ): Promise<User> {
    // Ensure user exists
    await this.findOne(db, id);

    await db
      .update(users)
      .set({
        ...updateUserDto,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));

    return this.findOne(db, id);
  }

  async remove(db: TenantDb, id: string): Promise<void> {
    // Ensure user exists
    await this.findOne(db, id);

    await db.delete(users).where(eq(users.id, id));
  }
}

