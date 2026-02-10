import { Module, Global } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service.js';
import { TenantMiddleware } from './tenant.middleware.js';

@Global()
@Module({
  providers: [TenantContextService, TenantMiddleware],
  exports: [TenantContextService, TenantMiddleware],
})
export class TenantModule {}

