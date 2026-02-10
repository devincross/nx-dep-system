import { Controller, Get } from '@nestjs/common';
import { CurrentTenant } from '../tenant/tenant.decorator.js';
import type { TenantContext } from '../tenant/tenant-context.service.js';

@Controller()
export class AppController {
  @Get('health')
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('tenant-info')
  getTenantInfo(@CurrentTenant() ctx: TenantContext) {
    return {
      tenant: {
        id: ctx.tenant.id,
        name: ctx.tenant.name,
        slug: ctx.tenant.slug,
      },
      domain: {
        id: ctx.domain.id,
        domain: ctx.domain.domain,
        isPrimary: ctx.domain.isPrimary,
      },
    };
  }
}

