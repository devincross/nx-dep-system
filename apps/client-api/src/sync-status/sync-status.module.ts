import { Module } from '@nestjs/common';
import { SyncStatusController } from './sync-status.controller.js';
import { SyncStatusService } from './sync-status.service.js';

@Module({
  controllers: [SyncStatusController],
  providers: [SyncStatusService],
  exports: [SyncStatusService],
})
export class SyncStatusModule {}

