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
import { migrateLandlordDb, migrateTenantDb, getLandlordDb, tenants, domains, getTenantConnection, orderItems } from '@org/database';
import { sql, like, eq, and, isNull } from 'drizzle-orm';

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

  @Post()
  create(@Body() createTenantDto: CreateTenantDto) {
    return this.tenantService.create(createTenantDto);
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

  /**
   * One-time cleanup: strip leading 'S' from all serial numbers across all tenants.
   */
  @Post('normalize-serials')
  async normalizeSerials() {
    this.logger.log('Starting serial number normalization across all tenants...');
    const db = getLandlordDb();

    const rows = await db
      .select({
        tenantId: tenants.id,
        slug: tenants.slug,
        dbHost: domains.dbHost,
        dbPort: domains.dbPort,
        dbName: domains.dbName,
        dbUser: domains.dbUser,
        dbPassword: domains.dbPassword,
        isPrimary: domains.isPrimary,
        domain: domains.domain,
      })
      .from(tenants)
      .innerJoin(domains, sql`${tenants.id} = ${domains.tenantId}`);

    // Group by tenant, pick primary domain
    const tenantMap = new Map<string, { slug: string; domain: string; dbHost: string; dbPort: number; dbName: string; dbUser: string; dbPassword: string }>();
    for (const row of rows) {
      const existing = tenantMap.get(row.tenantId);
      if (!existing || row.isPrimary) {
        tenantMap.set(row.tenantId, {
          slug: row.slug,
          domain: row.domain,
          dbHost: row.dbHost,
          dbPort: row.dbPort,
          dbName: row.dbName,
          dbUser: row.dbUser,
          dbPassword: row.dbPassword,
        });
      }
    }

    const results: { tenant: string; success: boolean; updated: number; found: number; message: string }[] = [];

    for (const [, tenant] of tenantMap) {
      try {
        const tenantDb = await getTenantConnection(tenant.domain, {
          host: tenant.dbHost,
          port: tenant.dbPort,
          database: tenant.dbName,
          user: tenant.dbUser,
          password: tenant.dbPassword,
        });

        const sRows = await tenantDb
          .select({ id: orderItems.id, serialNumber: orderItems.serialNumber })
          .from(orderItems)
          .where(like(orderItems.serialNumber, 'S%'));

        let updated = 0;
        for (const item of sRows) {
          const normalized = item.serialNumber.slice(1);
          if (!normalized) continue;

          const conflict = await tenantDb
            .select({ id: orderItems.id })
            .from(orderItems)
            .where(and(eq(orderItems.serialNumber, normalized), isNull(orderItems.deletedAt)))
            .limit(1);

          if (conflict.length > 0) {
            this.logger.warn(`[${tenant.slug}] Skipping ${item.serialNumber} → ${normalized}: conflict with item #${conflict[0].id}`);
            continue;
          }

          await tenantDb.update(orderItems)
            .set({ serialNumber: normalized, updatedAt: new Date() })
            .where(eq(orderItems.id, item.id));
          updated++;
        }

        results.push({ tenant: tenant.slug, success: true, updated, found: sRows.length, message: `${updated} updated out of ${sRows.length} found` });
        this.logger.log(`[${tenant.slug}] Serial normalization: ${updated}/${sRows.length}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ tenant: tenant.slug, success: false, updated: 0, found: 0, message });
        this.logger.error(`[${tenant.slug}] Serial normalization failed: ${message}`);
      }
    }

    const totalUpdated = results.reduce((sum, r) => sum + r.updated, 0);
    this.logger.log(`Serial normalization complete: ${totalUpdated} total serials updated across ${tenantMap.size} tenants`);

    return { totalTenants: tenantMap.size, totalUpdated, results };
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tenantService.findOne(id);
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
}

