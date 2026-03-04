import { Module } from '@nestjs/common';
import { TenantController } from './tenant.controller.js';
import { TenantService } from './tenant.service.js';
import { DomainModule } from '../domain/domain.module.js';

@Module({
  imports: [DomainModule],
  controllers: [TenantController],
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantModule {}

