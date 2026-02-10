import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  getLandlordDb,
  domains,
  tenants,
  Domain,
  Tenant,
  getTenantConnection,
  TenantDb,
} from '@org/database';

export interface TenantContext {
  tenant: Tenant;
  domain: Domain;
  db: TenantDb;
}

@Injectable()
export class TenantContextService {
  async resolveByDomain(domainName: string): Promise<TenantContext> {
    const landlordDb = getLandlordDb();

    // Find domain configuration
    const domainResults = await landlordDb
      .select()
      .from(domains)
      .where(eq(domains.domain, domainName));

    if (domainResults.length === 0) {
      throw new NotFoundException(`Domain "${domainName}" not found`);
    }

    const domain = domainResults[0];

    if (!domain.isActive) {
      throw new NotFoundException(`Domain "${domainName}" is not active`);
    }

    // Find tenant
    const tenantResults = await landlordDb
      .select()
      .from(tenants)
      .where(eq(tenants.id, domain.tenantId));

    if (tenantResults.length === 0) {
      throw new NotFoundException(
        `Tenant not found for domain "${domainName}"`
      );
    }

    const tenant = tenantResults[0];

    if (!tenant.isActive) {
      throw new NotFoundException(`Tenant "${tenant.name}" is not active`);
    }

    // Get or create tenant database connection
    const db = await getTenantConnection(domainName, {
      host: domain.dbHost,
      port: domain.dbPort,
      database: domain.dbName,
      user: domain.dbUser,
      password: domain.dbPassword,
    });

    return { tenant, domain, db };
  }
}

