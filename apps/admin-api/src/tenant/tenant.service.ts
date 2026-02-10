import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getLandlordDb, tenants, Tenant } from '@org/database';
import { CreateTenantDto, UpdateTenantDto } from './dto/index.js';

@Injectable()
export class TenantService {
  async findAll(): Promise<Tenant[]> {
    const db = getLandlordDb();
    return db.select().from(tenants);
  }

  async findOne(id: string): Promise<Tenant> {
    const db = getLandlordDb();
    const result = await db.select().from(tenants).where(eq(tenants.id, id));

    if (result.length === 0) {
      throw new NotFoundException(`Tenant with ID "${id}" not found`);
    }

    return result[0];
  }

  async findBySlug(slug: string): Promise<Tenant> {
    const db = getLandlordDb();
    const result = await db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, slug));

    if (result.length === 0) {
      throw new NotFoundException(`Tenant with slug "${slug}" not found`);
    }

    return result[0];
  }

  async create(createTenantDto: CreateTenantDto): Promise<Tenant> {
    const db = getLandlordDb();

    // Check if slug already exists
    const existing = await db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, createTenantDto.slug));

    if (existing.length > 0) {
      throw new ConflictException(
        `Tenant with slug "${createTenantDto.slug}" already exists`
      );
    }

    const id = uuidv4();
    const now = new Date();

    await db.insert(tenants).values({
      id,
      name: createTenantDto.name,
      slug: createTenantDto.slug,
      isActive: createTenantDto.isActive ?? true,
      metadata: createTenantDto.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    });

    return this.findOne(id);
  }

  async update(id: string, updateTenantDto: UpdateTenantDto): Promise<Tenant> {
    const db = getLandlordDb();

    // Ensure tenant exists
    await this.findOne(id);

    // Check slug uniqueness if updating slug
    if (updateTenantDto.slug) {
      const existing = await db
        .select()
        .from(tenants)
        .where(eq(tenants.slug, updateTenantDto.slug));

      if (existing.length > 0 && existing[0].id !== id) {
        throw new ConflictException(
          `Tenant with slug "${updateTenantDto.slug}" already exists`
        );
      }
    }

    await db
      .update(tenants)
      .set({
        ...updateTenantDto,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, id));

    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const db = getLandlordDb();

    // Ensure tenant exists
    await this.findOne(id);

    await db.delete(tenants).where(eq(tenants.id, id));
  }
}

