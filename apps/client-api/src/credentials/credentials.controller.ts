import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  UseGuards,
  Query,
} from '@nestjs/common';
import { CurrentTenant } from '../tenant/tenant.decorator.js';
import type { TenantContext } from '../tenant/tenant-context.service.js';
import { JwtAuthGuard } from '../auth/guards/index.js';
import { CredentialsService } from './credentials.service.js';
import { CertificateGeneratorService } from './certificate-generator.service.js';
import { CreateCredentialDto, UpdateCredentialDto } from './dto/index.js';

@Controller('credentials')
@UseGuards(JwtAuthGuard)
export class CredentialsController {
  constructor(
    private readonly credentialsService: CredentialsService,
    private readonly certificateGeneratorService: CertificateGeneratorService,
  ) {}

  @Get()
  async findAll(@CurrentTenant() tenant: TenantContext) {
    return this.credentialsService.findAll(tenant.db);
  }

  @Get('type/:type')
  async findByType(
    @CurrentTenant() tenant: TenantContext,
    @Param('type') type: 'dep' | 'zoho' | 'netsuite' | 'database' | 'ssl'
  ) {
    return this.credentialsService.findByType(tenant.db, type);
  }

  @Get(':id')
  async findOne(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseIntPipe) id: number
  ) {
    return this.credentialsService.findOne(tenant.db, id);
  }

  @Post()
  async create(
    @CurrentTenant() tenant: TenantContext,
    @Body() createCredentialDto: CreateCredentialDto
  ) {
    return this.credentialsService.create(tenant.db, createCredentialDto);
  }

  @Put(':id')
  async update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() updateCredentialDto: UpdateCredentialDto
  ) {
    return this.credentialsService.update(tenant.db, id, updateCredentialDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseIntPipe) id: number
  ) {
    return this.credentialsService.remove(tenant.db, id);
  }

  @Post(':id/restore')
  async restore(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseIntPipe) id: number
  ) {
    return this.credentialsService.restore(tenant.db, id);
  }

  @Delete(':id/permanent')
  @HttpCode(HttpStatus.NO_CONTENT)
  async hardDelete(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseIntPipe) id: number
  ) {
    return this.credentialsService.hardDelete(tenant.db, id);
  }

  /**
   * Generate an RSA key pair and self-signed X.509 certificate
   * for NetSuite OAuth 2.0 M2M authentication.
   *
   * Returns the certificate PEM (to upload to NetSuite) and private key.
   */
  @Post('generate-certificate')
  async generateCertificate(
    @Body() body: { keySize?: number; validityDays?: number; commonName?: string; organization?: string },
  ) {
    return this.certificateGeneratorService.generate({
      keySize: body.keySize,
      validityDays: body.validityDays,
      commonName: body.commonName,
      organization: body.organization,
    });
  }

  /**
   * Activate a credential and disable all other credentials of the same type.
   * Used for credential rotation — new credential becomes current, old one gets disabled.
   */
  @Post(':id/activate')
  async activate(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.credentialsService.activate(tenant.db, id);
  }
}
