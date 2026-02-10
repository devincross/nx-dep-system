import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { TenantMiddleware } from '../tenant/tenant.middleware.js';
import { UserModule } from '../user/user.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CredentialsModule } from '../credentials/credentials.module.js';
import { EncryptionModule } from '../encryption/encryption.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { NetsuiteModule } from '../netsuite/netsuite.module.js';

@Module({
  imports: [EncryptionModule, TenantModule, UserModule, AuthModule, CredentialsModule, OrdersModule, NetsuiteModule],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply tenant middleware to all routes except health check
    consumer
      .apply(TenantMiddleware)
      .exclude('api/health')
      .forRoutes('*');
  }
}

