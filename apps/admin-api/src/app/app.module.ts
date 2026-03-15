import { Module, OnModuleInit } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { DomainModule } from '../domain/domain.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { Logger } from '@nestjs/common';
import { createLandlordConnection, migrateLandlordDb } from '@org/database';

@Module({
  imports: [TenantModule, DomainModule, AuthModule, ReportsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements OnModuleInit {
  private readonly logger = new Logger(AppModule.name);

  async onModuleInit() {
    // Run pending landlord migrations then connect
    this.logger.log('Running landlord database migrations...');
    await migrateLandlordDb();
    this.logger.log('Migrations complete');

    await createLandlordConnection();
  }
}
