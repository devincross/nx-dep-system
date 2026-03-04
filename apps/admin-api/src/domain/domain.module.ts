import { Module } from '@nestjs/common';
import { DomainController } from './domain.controller.js';
import { DomainService } from './domain.service.js';
import { DatabaseProvisioningService } from './database-provisioning.service.js';

@Module({
  controllers: [DomainController],
  providers: [DomainService, DatabaseProvisioningService],
  exports: [DomainService, DatabaseProvisioningService],
})
export class DomainModule {}

