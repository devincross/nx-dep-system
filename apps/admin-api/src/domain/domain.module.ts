import { Module } from '@nestjs/common';
import { DomainController } from './domain.controller.js';
import { DomainService } from './domain.service.js';

@Module({
  controllers: [DomainController],
  providers: [DomainService],
  exports: [DomainService],
})
export class DomainModule {}

