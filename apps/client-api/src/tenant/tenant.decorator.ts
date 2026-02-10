import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenantContext } from './tenant-context.service.js';

// Re-export TenantContext for convenience
export type { TenantContext } from './tenant-context.service.js';

/**
 * Parameter decorator to extract tenant context from the request.
 *
 * Usage:
 * - @CurrentTenant() ctx: TenantContext - Get full tenant context
 * - @CurrentTenant('tenant') tenant: Tenant - Get just the tenant
 * - @CurrentTenant('domain') domain: Domain - Get just the domain
 * - @CurrentTenant('db') db: TenantDb - Get just the database connection
 */
export const CurrentTenant = createParamDecorator(
  (data: keyof TenantContext | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const tenantContext: TenantContext = request.tenantContext;

    if (!tenantContext) {
      return null;
    }

    return data ? tenantContext[data] : tenantContext;
  }
);

