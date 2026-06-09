import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getLandlordDb, tenants, domains, Tenant } from '@org/database';
import { CreateTenantDto, UpdateTenantDto } from './dto/index.js';
import { DatabaseProvisioningService } from '../domain/database-provisioning.service.js';

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(
    private readonly databaseProvisioningService: DatabaseProvisioningService
  ) {}
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

    // Check if domain already exists
    const baseDomain = process.env['DOMAIN'] || '801saas.com';
    const fullDomain = `${createTenantDto.subdomain}.${baseDomain}`;
    const existingDomain = await db
      .select()
      .from(domains)
      .where(eq(domains.domain, fullDomain));

    if (existingDomain.length > 0) {
      throw new ConflictException(
        `Domain "${fullDomain}" already exists`
      );
    }

    // Generate database name from slug (replace hyphens with underscores)
    const dbName = `tenant_${createTenantDto.slug.replace(/-/g, '_')}`;

    // Get database credentials from environment
    const dbHost = process.env['LANDLORD_DB_HOST'] || 'localhost';
    const dbPort = parseInt(process.env['LANDLORD_DB_PORT'] || '3306', 10);
    const dbUser = process.env['LANDLORD_DB_USER'] || 'dep_user';
    const dbPassword = process.env['LANDLORD_DB_PASSWORD'] || '';

    // Provision the database first
    this.logger.log(`Provisioning database ${dbName} for tenant ${createTenantDto.name}`);
    await this.databaseProvisioningService.provisionDatabase({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: dbName,
    });

    const tenantId = uuidv4();
    const domainId = uuidv4();
    const now = new Date();

    // Create the tenant
    await db.insert(tenants).values({
      id: tenantId,
      name: createTenantDto.name,
      slug: createTenantDto.slug,
      isActive: createTenantDto.isActive ?? true,
      syncEnabled: createTenantDto.syncEnabled ?? false,
      metadata: createTenantDto.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    });

    // Create the domain
    await db.insert(domains).values({
      id: domainId,
      tenantId: tenantId,
      domain: fullDomain,
      isPrimary: true,
      dbHost: dbHost,
      dbPort: dbPort,
      dbName: dbName,
      dbUser: dbUser,
      dbPassword: dbPassword,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    this.logger.log(`Created tenant ${createTenantDto.name} with domain ${fullDomain} and database ${dbName}`);

    return this.findOne(tenantId);
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

