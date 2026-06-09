import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getLandlordDb, domains, tenants, Domain } from '@org/database';
import { CreateDomainDto, UpdateDomainDto } from './dto/index.js';
import { DatabaseProvisioningService } from './database-provisioning.service.js';

@Injectable()
export class DomainService {
  private readonly logger = new Logger(DomainService.name);

  constructor(
    private readonly databaseProvisioningService: DatabaseProvisioningService
  ) {}
  async findAll(): Promise<Domain[]> {
    const db = getLandlordDb();
    return db.select().from(domains);
  }

  async findByTenantId(tenantId: string): Promise<Domain[]> {
    const db = getLandlordDb();
    return db.select().from(domains).where(eq(domains.tenantId, tenantId));
  }

  async findOne(id: string): Promise<Domain> {
    const db = getLandlordDb();
    const result = await db.select().from(domains).where(eq(domains.id, id));

    if (result.length === 0) {
      throw new NotFoundException(`Domain with ID "${id}" not found`);
    }

    return result[0];
  }

  async findByDomainName(domainName: string): Promise<Domain> {
    const db = getLandlordDb();
    const result = await db
      .select()
      .from(domains)
      .where(eq(domains.domain, domainName));

    if (result.length === 0) {
      throw new NotFoundException(`Domain "${domainName}" not found`);
    }

    return result[0];
  }

  async create(createDomainDto: CreateDomainDto): Promise<Domain> {
    const db = getLandlordDb();

    // Verify tenant exists
    const tenantResult = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, createDomainDto.tenantId));

    if (tenantResult.length === 0) {
      throw new BadRequestException(
        `Tenant with ID "${createDomainDto.tenantId}" not found`
      );
    }

    // Check if domain already exists
    const existing = await db
      .select()
      .from(domains)
      .where(eq(domains.domain, createDomainDto.domain));

    if (existing.length > 0) {
      throw new ConflictException(
        `Domain "${createDomainDto.domain}" already exists`
      );
    }

    // Provision the database (create it and run migrations)
    this.logger.log(`Provisioning database for domain: ${createDomainDto.domain}`);
    try {
      await this.databaseProvisioningService.provisionDatabase({
        host: createDomainDto.dbHost,
        port: createDomainDto.dbPort ?? 3306,
        user: createDomainDto.dbUser,
        password: createDomainDto.dbPassword,
        database: createDomainDto.dbName,
      });
    } catch (error) {
      this.logger.error(`Failed to provision database: ${error}`);
      throw new BadRequestException(
        `Failed to provision database: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // If this is set as primary, unset other primary domains for this tenant
    if (createDomainDto.isPrimary) {
      await db
        .update(domains)
        .set({ isPrimary: false })
        .where(eq(domains.tenantId, createDomainDto.tenantId));
    }

    const id = uuidv4();
    const now = new Date();

    await db.insert(domains).values({
      id,
      tenantId: createDomainDto.tenantId,
      domain: createDomainDto.domain,
      isPrimary: createDomainDto.isPrimary ?? false,
      dbHost: createDomainDto.dbHost,
      dbPort: createDomainDto.dbPort ?? 3306,
      dbName: createDomainDto.dbName,
      dbUser: createDomainDto.dbUser,
      dbPassword: createDomainDto.dbPassword,
      isActive: createDomainDto.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    });

    return this.findOne(id);
  }

  async update(id: string, updateDomainDto: UpdateDomainDto): Promise<Domain> {
    const db = getLandlordDb();

    // Ensure domain exists
    const existingDomain = await this.findOne(id);

    // Check domain uniqueness if updating domain name
    if (updateDomainDto.domain) {
      const existing = await db
        .select()
        .from(domains)
        .where(eq(domains.domain, updateDomainDto.domain));

      if (existing.length > 0 && existing[0].id !== id) {
        throw new ConflictException(
          `Domain "${updateDomainDto.domain}" already exists`
        );
      }
    }

    // If setting as primary, unset other primary domains for this tenant
    if (updateDomainDto.isPrimary) {
      await db
        .update(domains)
        .set({ isPrimary: false })
        .where(eq(domains.tenantId, existingDomain.tenantId));
    }

    await db
      .update(domains)
      .set({
        ...updateDomainDto,
        updatedAt: new Date(),
      })
      .where(eq(domains.id, id));

    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const db = getLandlordDb();

    // Ensure domain exists
    await this.findOne(id);

    await db.delete(domains).where(eq(domains.id, id));
  }

  async testConnection(
    id: string
  ): Promise<{ success: boolean; message: string }> {
    const domain = await this.findOne(id);

    try {
      const mysql = await import('mysql2/promise');
      const connection = await mysql.default.createConnection({
        host: domain.dbHost,
        port: domain.dbPort,
        database: domain.dbName,
        user: domain.dbUser,
        password: domain.dbPassword,
        connectTimeout: 5000,
      });

      await connection.ping();
      await connection.end();

      return { success: true, message: 'Connection successful' };
    } catch (error) {
      return {
        success: false,
        message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  async provisionDatabase(
    id: string
  ): Promise<{ success: boolean; message: string }> {
    const domain = await this.findOne(id);

    this.logger.log(`Provisioning database for domain: ${domain.domain}`);

    try {
      await this.databaseProvisioningService.provisionDatabase({
        host: domain.dbHost,
        port: domain.dbPort,
        user: domain.dbUser,
        password: domain.dbPassword,
        database: domain.dbName,
      });

      return {
        success: true,
        message: `Database "${domain.dbName}" provisioned successfully`,
      };
    } catch (error) {
      this.logger.error(`Failed to provision database: ${error}`);
      return {
        success: false,
        message: `Failed to provision database: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}

