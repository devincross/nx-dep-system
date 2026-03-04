import { Module, OnModuleInit } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { DomainModule } from '../domain/domain.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { createLandlordConnection } from '@org/database';

@Module({
  imports: [TenantModule, DomainModule, AuthModule, ReportsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements OnModuleInit {
  async onModuleInit() {
    // Initialize the landlord database connection on app startup
    await createLandlordConnection();
  }
}
