import { Controller, Get, UseGuards } from '@nestjs/common';
import { X509Certificate } from 'crypto';
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

  @Get('dep-status')
  @UseGuards(JwtAuthGuard)
  async getDepStatus(@CurrentTenant() ctx: TenantContext) {
    try {
      const credential = await this.credentialsService.findNewestActiveByType(ctx.db, 'dep');

      if (!credential) {
        return {
          configured: false,
          status: 'not_configured',
          message: 'No DEP credentials configured',
        };
      }

      const data = credential.connectionData as Record<string, unknown>;
      const sslCert = data['ssl_cert'] as string | undefined;
      const sslKey = data['ssl_key'] as string | undefined;
      const apiUrl = data['apple_api_url'] as string | undefined;
      const depResellerId = data['dep_reseller_id'] as string | undefined;
      const shipTo = data['sap_ship_to'] as string | undefined;
      const soldTo = data['sap_sold_to'] as string | undefined;

      // Parse certificate to get expiration
      let certificateExpiresAt: string | undefined;
      let certificateSubject: string | undefined;
      let certificateIssuer: string | undefined;
      let expirationWarning: string | undefined;
      let daysUntilExpiry: number | undefined;
      let hasCertificate = false;
      const hasPrivateKey = !!sslKey;

      if (sslCert) {
        try {
          // Ensure PEM format
          let pem = sslCert;
          if (!pem.includes('-----BEGIN CERTIFICATE-----')) {
            pem = `-----BEGIN CERTIFICATE-----\n${pem}\n-----END CERTIFICATE-----`;
          }
          const x509 = new X509Certificate(pem);
          certificateExpiresAt = new Date(x509.validTo).toISOString();
          certificateSubject = x509.subject;
          certificateIssuer = x509.issuer;
          hasCertificate = true;

          const now = new Date();
          daysUntilExpiry = Math.floor(
            (new Date(x509.validTo).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
          );

          if (daysUntilExpiry < 0) {
            expirationWarning = 'DEP certificate has expired!';
          } else if (daysUntilExpiry <= 30) {
            expirationWarning = `DEP certificate expires in ${daysUntilExpiry} days`;
          } else if (daysUntilExpiry <= 60) {
            expirationWarning = `DEP certificate expires in ${daysUntilExpiry} days — consider renewing soon`;
          }
        } catch {
          // Certificate couldn't be parsed — might be pending (CSR generated but cert not uploaded yet)
        }
      }

      return {
        configured: true,
        status: credential.status,
        credentialId: credential.id,
        apiUrl,
        depResellerId,
        shipTo,
        soldTo,
        hasCertificate,
        hasPrivateKey,
        certificateExpiresAt,
        certificateSubject,
        certificateIssuer,
        daysUntilExpiry,
        expirationWarning,
        pendingCertUpload: hasPrivateKey && !hasCertificate,
        createdAt: credential.createdAt,
        updatedAt: credential.updatedAt,
      };
    } catch (error) {
      return {
        configured: false,
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

