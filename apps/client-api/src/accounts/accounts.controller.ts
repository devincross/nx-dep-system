import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentTenant } from '../tenant/tenant.decorator.js';
import type { TenantContext } from '../tenant/tenant-context.service.js';
import { JwtAuthGuard } from '../auth/guards/index.js';
import { AccountsService } from './accounts.service.js';

@Controller('accounts')
@UseGuards(JwtAuthGuard)
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  /**
   * List accounts. Optional ?search=... filters across name / external id / DEP id.
   */
  @Get()
  async findAll(
    @CurrentTenant() tenant: TenantContext,
    @Query('search') search?: string,
  ) {
    return this.accountsService.findAll(tenant.db, search);
  }

  /**
   * Pull every account from NetSuite (last_modified 2008-01-01) and upsert
   * into the local accounts table.
   */
  @Post('sync')
  async syncAll(@CurrentTenant() tenant: TenantContext) {
    return this.accountsService.syncAll(tenant.db);
  }
}
