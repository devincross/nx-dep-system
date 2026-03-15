import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { HistoricalImportController } from './historical-import.controller.js';
import { HistoricalImportService } from './historical-import.service.js';
import { CredentialsModule } from '../credentials/credentials.module.js';

@Module({
  imports: [CredentialsModule],
  controllers: [OrdersController, HistoricalImportController],
  providers: [OrdersService, HistoricalImportService],
  exports: [OrdersService],
})
export class OrdersModule {}
