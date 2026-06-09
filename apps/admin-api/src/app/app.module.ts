import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { DomainModule } from '../domain/domain.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { createLandlordConnection, migrateLandlordDb } from '@org/database';

@Module({
  imports: [TenantModule, DomainModule, AuthModule, ReportsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements OnModuleInit {
  private readonly logger = new Logger(AppModule.name);

  async onModuleInit() {
    // Run landlord migrations on startup so all columns exist
    this.logger.log('Running landlord database migrations...');
    await migrateLandlordDb();
    this.logger.log('Landlord migrations complete');

    await createLandlordConnection();
  }
}
