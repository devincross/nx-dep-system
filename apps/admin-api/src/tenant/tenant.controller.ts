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
import { migrateTenantDb } from '@org/database';

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
   * Iterates every tenant, finds their primary domain, and runs
   * pending migrations against each tenant database.
   */
  @Post('migrate-all')
  async migrateAll() {
    this.logger.log('Starting migration for all tenants...');

    const allTenants = await this.tenantService.findAll();
    const results: { tenant: string; success: boolean; message: string }[] = [];

    for (const tenant of allTenants) {
      try {
        const tenantDomains = await this.domainService.findByTenantId(tenant.id);
        const primaryDomain = tenantDomains.find((d) => d.isPrimary) ?? tenantDomains[0];

        if (!primaryDomain) {
          results.push({ tenant: tenant.slug, success: false, message: 'No domain configured' });
          continue;
        }

        await migrateTenantDb({
          host: primaryDomain.dbHost,
          port: primaryDomain.dbPort,
          database: primaryDomain.dbName,
          user: primaryDomain.dbUser,
          password: primaryDomain.dbPassword,
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

    return { total: allTenants.length, succeeded, failed, results };
  }
}

