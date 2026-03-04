import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getLandlordDb, landlordUsers, LandlordUser } from '@org/database';
import { CreateUserDto, UpdateUserDto, LoginDto } from './dto/index.js';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  private hashPassword(password: string): string {
    // Using SHA-256 for password hashing
    // In production, consider using bcrypt or argon2
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  async findAll(): Promise<Omit<LandlordUser, 'password'>[]> {
    const db = getLandlordDb();
    const result = await db.select().from(landlordUsers);
    // Remove password from response
    return result.map(({ password: _password, ...user }) => user);
  }

  async findOne(id: string): Promise<Omit<LandlordUser, 'password'>> {
    const db = getLandlordDb();
    const result = await db.select().from(landlordUsers).where(eq(landlordUsers.id, id));

    if (result.length === 0) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    const { password, ...user } = result[0];
    return user;
  }

  async findByEmail(email: string): Promise<LandlordUser | null> {
    const db = getLandlordDb();
    const result = await db.select().from(landlordUsers).where(eq(landlordUsers.email, email));

    if (result.length === 0) {
      return null;
    }

    return result[0];
  }

  async create(createUserDto: CreateUserDto): Promise<Omit<LandlordUser, 'password'>> {
    const db = getLandlordDb();

    // Check if email already exists
    const existing = await db
      .select()
      .from(landlordUsers)
      .where(eq(landlordUsers.email, createUserDto.email));

    if (existing.length > 0) {
      throw new ConflictException(
        `User with email "${createUserDto.email}" already exists`
      );
    }

    const id = uuidv4();
    const now = new Date();

    await db.insert(landlordUsers).values({
      id,
      name: createUserDto.name,
      email: createUserDto.email,
      password: this.hashPassword(createUserDto.password),
      status: createUserDto.status ?? 'active',
      createdAt: now,
      updatedAt: now,
    });

    return this.findOne(id);
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto
  ): Promise<Omit<LandlordUser, 'password'>> {
    const db = getLandlordDb();

    // Ensure user exists
    await this.findOne(id);

    // Check email uniqueness if updating email
    if (updateUserDto.email) {
      const existing = await db
        .select()
        .from(landlordUsers)
        .where(eq(landlordUsers.email, updateUserDto.email));

      if (existing.length > 0 && existing[0].id !== id) {
        throw new ConflictException(
          `User with email "${updateUserDto.email}" already exists`
        );
      }
    }

    // Hash password if provided
    const updateData: Record<string, unknown> = {
      ...updateUserDto,
      updatedAt: new Date(),
    };

    if (updateUserDto.password) {
      updateData.password = this.hashPassword(updateUserDto.password);
    }

    await db.update(landlordUsers).set(updateData).where(eq(landlordUsers.id, id));

    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const db = getLandlordDb();

    // Ensure user exists
    await this.findOne(id);

    await db.delete(landlordUsers).where(eq(landlordUsers.id, id));
  }

  async validateUser(
    email: string,
    password: string
  ): Promise<Omit<LandlordUser, 'password'> | null> {
    const user = await this.findByEmail(email);

    if (!user) {
      return null;
    }

    const hashedPassword = this.hashPassword(password);
    if (user.password !== hashedPassword) {
      return null;
    }

    // Check if user is active
    if (user.status !== 'active') {
      return null;
    }

    const { password: _, ...result } = user;
    return result;
  }

  async login(
    loginDto: LoginDto
  ): Promise<{ access_token: string; user: Omit<LandlordUser, 'password'> }> {
    const user = await this.validateUser(loginDto.email, loginDto.password);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload = { sub: user.id, email: user.email };

    return {
      access_token: this.jwtService.sign(payload),
      user,
    };
  }
}

