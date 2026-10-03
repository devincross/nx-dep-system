import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { TenantUsersService } from './tenant-users.service.js';
import { CreateTenantUserDto, UpdateTenantUserDto } from './dto/index.js';

/** Manage the portal users inside a client's database. Landlord admins only. */
@Controller('tenants/:tenantId/users')
@UseGuards(JwtAuthGuard)
export class TenantUsersController {
  constructor(private readonly tenantUsersService: TenantUsersService) {}

  @Get()
  list(@Param('tenantId') tenantId: string) {
    return this.tenantUsersService.list(tenantId);
  }

  @Post()
  create(@Param('tenantId') tenantId: string, @Body() dto: CreateTenantUserDto) {
    return this.tenantUsersService.create(tenantId, dto);
  }

  @Put(':userId')
  update(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateTenantUserDto,
  ) {
    return this.tenantUsersService.update(tenantId, userId, dto);
  }
}
