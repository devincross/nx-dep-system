import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

// Application layer
import { SyncAccountsUseCase, SyncOrdersUseCase } from '../application/index.js';

// Infrastructure layer
import { MapperRegistry } from '../infrastructure/adapters/mapper-registry.js';
import { NetsuiteAdapter } from '../infrastructure/adapters/netsuite/netsuite.adapter.js';
import { NetsuiteBaseMapper, ByuNetsuiteMapper } from '../infrastructure/adapters/netsuite/mappers/index.js';
import { ZohoAdapter } from '../infrastructure/adapters/zoho/zoho.adapter.js';
import { ZohoBaseMapper } from '../infrastructure/adapters/zoho/mappers/index.js';
import {
  AccountRepository,
  OrderRepository,
  SyncStatusRepository,
} from '../infrastructure/repositories/index.js';

// Scheduler
import { SyncScheduler } from '../scheduler/sync.scheduler.js';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AppController],
  providers: [
    AppService,
    // Use cases
    SyncAccountsUseCase,
    SyncOrdersUseCase,
    // Adapters
    MapperRegistry,
    NetsuiteAdapter,
    ZohoAdapter,
    // Mappers
    NetsuiteBaseMapper,
    ByuNetsuiteMapper,
    ZohoBaseMapper,
    // Repositories
    AccountRepository,
    OrderRepository,
    SyncStatusRepository,
    // Scheduler
    SyncScheduler,
  ],
})
export class AppModule implements OnModuleInit {
  private readonly logger = new Logger(AppModule.name);

  constructor(private readonly mapperRegistry: MapperRegistry) {}

  onModuleInit() {
    // Register all mappers
    this.logger.log('Registering mappers...');

    // NetSuite mappers
    this.mapperRegistry.register('netsuite-default', NetsuiteBaseMapper);
    this.mapperRegistry.register('byu', ByuNetsuiteMapper);

    // Zoho mappers
    this.mapperRegistry.register('zoho-default', ZohoBaseMapper);

    this.logger.log(`Registered mappers: ${this.mapperRegistry.getRegisteredMappers().join(', ')}`);
  }
}
