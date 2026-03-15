import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { TenantService } from './tenant.service.js';
import { CreateTenantDto, UpdateTenantDto } from './dto/index.js';
import { DomainService } from '../domain/domain.service.js';
import { migrateLandlordDb, migrateTenantDb, getLandlordDb, tenants, domains } from '@org/database';
import { sql } from 'drizzle-orm';

@Controller('tenants')
export class TenantController {
  private readonly logger = new Logger(TenantController.name);

  constructor(
    private readonly tenantService: TenantService,
    private readonly domainService: DomainService,
  ) {}

  @Get()
  findAll() {
    return this.tenantService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tenantService.findOne(id);
  }

  @Post()
  create(@Body() createTenantDto: CreateTenantDto) {
    return this.tenantService.create(createTenantDto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateTenantDto: UpdateTenantDto) {
    return this.tenantService.update(id, updateTenantDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.tenantService.remove(id);
  }

  /**
   * Run database migrations on all tenants.
   *
   * 1. Runs landlord migrations first (e.g. adding sync_enabled column)
   * 2. Queries only id/slug from tenants (safe even if schema is outdated)
   * 3. Joins domains to get DB credentials
   * 4. Runs tenant migrations on each database
   */
  @Post('migrate-all')
  async migrateAll() {
    this.logger.log('Running landlord migrations...');
    await migrateLandlordDb();

    this.logger.log('Starting tenant migrations...');
    const db = getLandlordDb();

    // Minimal query — only the columns that have always existed
    const rows = await db
      .select({
        tenantId: tenants.id,
        slug: tenants.slug,
        domainId: domains.id,
        dbHost: domains.dbHost,
        dbPort: domains.dbPort,
        dbName: domains.dbName,
        dbUser: domains.dbUser,
        dbPassword: domains.dbPassword,
        isPrimary: domains.isPrimary,
      })
      .from(tenants)
      .innerJoin(domains, sql`${tenants.id} = ${domains.tenantId}`);

    // Group by tenant, pick primary domain (or first)
    const tenantMap = new Map<string, { slug: string; dbHost: string; dbPort: number; dbName: string; dbUser: string; dbPassword: string }>();
    for (const row of rows) {
      const existing = tenantMap.get(row.tenantId);
      if (!existing || row.isPrimary) {
        tenantMap.set(row.tenantId, {
          slug: row.slug,
          dbHost: row.dbHost,
          dbPort: row.dbPort,
          dbName: row.dbName,
          dbUser: row.dbUser,
          dbPassword: row.dbPassword,
        });
      }
    }

    const results: { tenant: string; success: boolean; message: string }[] = [];

    for (const [, tenant] of tenantMap) {
      try {
        await migrateTenantDb({
          host: tenant.dbHost,
          port: tenant.dbPort,
          database: tenant.dbName,
          user: tenant.dbUser,
          password: tenant.dbPassword,
        });

        results.push({ tenant: tenant.slug, success: true, message: 'Migrations applied' });
        this.logger.log(`Migrated tenant: ${tenant.slug}`);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ tenant: tenant.slug, success: false, message });
        this.logger.error(`Failed to migrate tenant ${tenant.slug}: ${message}`);
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    this.logger.log(`Migration complete: ${succeeded} succeeded, ${failed} failed`);

    return { total: tenantMap.size, succeeded, failed, results };
  }
}

