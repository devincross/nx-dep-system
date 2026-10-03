import { Module } from '@nestjs/common';
import { TenantController } from './tenant.controller.js';
import { TenantService } from './tenant.service.js';
import { TenantUsersController } from './tenant-users.controller.js';
import { TenantUsersService } from './tenant-users.service.js';
import { DomainModule } from '../domain/domain.module.js';

@Module({
  imports: [DomainModule],
  controllers: [TenantController, TenantUsersController],
  providers: [TenantService, TenantUsersService],
  exports: [TenantService],
})
export class TenantModule {}

