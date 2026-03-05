import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentTenant } from '../tenant/tenant.decorator.js';
import type { TenantContext } from '../tenant/tenant-context.service.js';
import { CredentialsService } from '../credentials/credentials.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

interface TenantMetadata {
  connectionType?: 'netsuite' | 'zoho';
}

@Controller()
export class AppController {
  constructor(private readonly credentialsService: CredentialsService) {}

  @Get('health')
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('tenant-info')
  getTenantInfo(@CurrentTenant() ctx: TenantContext) {
    const metadata: TenantMetadata = ctx.tenant.metadata
      ? JSON.parse(ctx.tenant.metadata)
      : {};

    return {
      tenant: {
        id: ctx.tenant.id,
        name: ctx.tenant.name,
        slug: ctx.tenant.slug,
        connectionType: metadata.connectionType || 'netsuite',
      },
      domain: {
        id: ctx.domain.id,
        domain: ctx.domain.domain,
        isPrimary: ctx.domain.isPrimary,
      },
    };
  }

  @Get('connection-status')
  @UseGuards(JwtAuthGuard)
  async getConnectionStatus(@CurrentTenant() ctx: TenantContext) {
    const metadata: TenantMetadata = ctx.tenant.metadata
      ? JSON.parse(ctx.tenant.metadata)
      : {};

    const connectionType = metadata.connectionType || 'netsuite';

    try {
      const credential = await this.credentialsService.findNewestActiveByType(
        ctx.db,
        connectionType
      );

      if (!credential) {
        return {
          connectionType,
          configured: false,
          status: 'not_configured',
          message: `No ${connectionType} credentials configured`,
        };
      }

      // Extract expiration info from connection data
      const connectionData = credential.connectionData as Record<string, unknown>;
      const certificateExpiresAt = connectionData.certificate_expires_at as string | undefined;

      // Check if certificate is expiring soon (within 30 days)
      let expirationWarning: string | undefined;
      if (certificateExpiresAt) {
        const expiresAt = new Date(certificateExpiresAt);
        const now = new Date();
        const daysUntilExpiry = Math.floor((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        if (daysUntilExpiry < 0) {
          expirationWarning = 'Certificate has expired!';
        } else if (daysUntilExpiry <= 30) {
          expirationWarning = `Certificate expires in ${daysUntilExpiry} days`;
        }
      }

      return {
        connectionType,
        configured: true,
        status: credential.status,
        credentialId: credential.id,
        createdAt: credential.createdAt,
        updatedAt: credential.updatedAt,
        certificateExpiresAt,
        expirationWarning,
      };
    } catch (error) {
      return {
        connectionType,
        configured: false,
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

