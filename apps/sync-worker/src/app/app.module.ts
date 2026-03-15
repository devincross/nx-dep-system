import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PushChangesController } from './push-changes.controller.js';
import { PushChangesService } from './push-changes.service.js';

// Application layer
import { SyncAccountsUseCase, SyncOrdersUseCase, PushChangesUseCase } from '../application/index.js';
import { DepEnrollUseCase } from '../application/dep-enroll.use-case.js';

// Infrastructure layer
import { MapperRegistry } from '../infrastructure/adapters/mapper-registry.js';
import { NetsuiteAdapter } from '../infrastructure/adapters/netsuite/netsuite.adapter.js';
import { NetsuiteBaseMapper, ByuNetsuiteMapper } from '../infrastructure/adapters/netsuite/mappers/index.js';
import { ZohoAdapter } from '../infrastructure/adapters/zoho/zoho.adapter.js';
import { ZohoBaseMapper } from '../infrastructure/adapters/zoho/mappers/index.js';
import { DownstreamSyncAdapter } from '../infrastructure/adapters/downstream/downstream-sync.adapter.js';
import { DepSyncAdapter } from '../infrastructure/adapters/dep/dep-sync.adapter.js';
import {
  AccountRepository,
  OrderRepository,
  SyncStatusRepository,
  OrderChangeRepository,
} from '../infrastructure/repositories/index.js';
import { DepTransactionRepository } from '../infrastructure/repositories/dep-transaction.repository.js';

// Schedulers
import { SyncScheduler } from '../scheduler/sync.scheduler.js';
import { DepPollScheduler } from '../scheduler/dep-poll.scheduler.js';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AppController, PushChangesController],
  providers: [
    AppService,
    PushChangesService,
    // Use cases
    SyncAccountsUseCase,
    SyncOrdersUseCase,
    PushChangesUseCase,
    DepEnrollUseCase,
    // Adapters
    MapperRegistry,
    NetsuiteAdapter,
    ZohoAdapter,
    DownstreamSyncAdapter,
    DepSyncAdapter,
    // Mappers
    NetsuiteBaseMapper,
    ByuNetsuiteMapper,
    ZohoBaseMapper,
    // Repositories
    AccountRepository,
    OrderRepository,
    SyncStatusRepository,
    OrderChangeRepository,
    DepTransactionRepository,
    // Schedulers
    SyncScheduler,
    DepPollScheduler,
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
