import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { HistoricalImportController } from './historical-import.controller.js';
import { HistoricalImportService } from './historical-import.service.js';
import { DepActionsController } from './dep-actions.controller.js';
import { DepActionsService } from './dep-actions.service.js';
import { CredentialsModule } from '../credentials/credentials.module.js';

@Module({
  imports: [CredentialsModule],
  controllers: [OrdersController, HistoricalImportController, DepActionsController],
  providers: [OrdersService, HistoricalImportService, DepActionsService],
  exports: [OrdersService],
})
export class OrdersModule {}
