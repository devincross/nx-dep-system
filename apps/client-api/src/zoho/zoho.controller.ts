import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { JwtAuthGuard, RolesGuard } from '../auth/guards/index.js';
import { Roles } from '../auth/decorators/index.js';
import { CurrentTenant } from '../tenant/tenant.decorator.js';
import type { TenantContext } from '../tenant/tenant-context.service.js';
import { ZohoOAuthService } from './zoho-oauth.service.js';
import { ZohoService } from './zoho.service.js';

class AuthUrlQueryDto {
  @IsString()
  @IsNotEmpty()
  client_id!: string;

  @IsString()
  @IsNotEmpty()
  redirect_uri!: string;

  @IsOptional()
  @IsString()
  data_center?: string;

  @IsOptional()
  @IsString()
  scopes?: string;
}

class ExchangeCodeDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  client_id!: string;

  @IsString()
  @IsNotEmpty()
  client_secret!: string;

  @IsString()
  @IsNotEmpty()
  redirect_uri!: string;

  @IsOptional()
  @IsString()
  accounts_server?: string;

  @IsOptional()
  @IsString()
  data_center?: string;
}

class ExchangeGrantTokenDto {
  @IsString()
  @IsNotEmpty()
  grant_token!: string;

  @IsString()
  @IsNotEmpty()
  client_id!: string;

  @IsString()
  @IsNotEmpty()
  client_secret!: string;

  @IsOptional()
  @IsString()
  data_center?: string;
}

@Controller('zoho')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class ZohoController {
  constructor(
    private readonly zohoOAuthService: ZohoOAuthService,
    private readonly zohoService: ZohoService
  ) {}

  /**
   * Get available Zoho data centers
   */
  @Get('data-centers')
  getDataCenters() {
    return this.zohoOAuthService.getDataCenters();
  }

  /**
   * Current Zoho credential status (without sensitive data).
   */
  @Get('status')
  getStatus(@CurrentTenant() tenant: TenantContext) {
    return this.zohoService.getStatus(tenant.db);
  }

  /**
   * Test the Zoho connection by reading one record from the orders module.
   */
  @Get('test')
  testConnection(@CurrentTenant() tenant: TenantContext) {
    return this.zohoService.testConnection(tenant.db);
  }

  /**
   * Read records from the configured orders (sales orders) module.
   * Query: since (ISO/date, optional), per_page (optional).
   */
  @Get('orders')
  getOrders(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: { since?: string; per_page?: string }
  ) {
    return this.zohoService.getOrders(tenant.db, query);
  }

  /**
   * Read records from the configured accounts module.
   * Query: since (ISO/date, optional), per_page (optional).
   */
  @Get('accounts')
  getAccounts(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: { since?: string; per_page?: string }
  ) {
    return this.zohoService.getAccounts(tenant.db, query);
  }

  /**
   * Read records from an arbitrary Zoho CRM module (diagnostic, read-only).
   * Query: module (required), since (optional), per_page (optional).
   */
  @Get('module')
  fetchModule(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: { module?: string; since?: string; per_page?: string }
  ) {
    if (!query.module) {
      return { success: false, error: 'A module name is required.' };
    }
    return this.zohoService.fetchModule(tenant.db, query.module, query);
  }

  /**
   * Build the Zoho OAuth2 authorization URL.
   * The frontend redirects the user to this URL to authorize.
   */
  @Get('auth-url')
  getAuthUrl(@Query() query: AuthUrlQueryDto) {
    const url = this.zohoOAuthService.buildAuthUrl({
      clientId: query.client_id,
      redirectUri: query.redirect_uri,
      dataCenter: query.data_center,
      scopes: query.scopes ? query.scopes.split(',') : undefined,
    });

    return { url };
  }

  /**
   * Exchange an authorization code (from Zoho redirect) for tokens.
   * Returns the refresh_token and api_domain to store in credentials.
   */
  @Post('exchange-token')
  async exchangeToken(@Body() body: ExchangeCodeDto) {
    const result = await this.zohoOAuthService.exchangeCodeForTokens({
      code: body.code,
      clientId: body.client_id,
      clientSecret: body.client_secret,
      redirectUri: body.redirect_uri,
      accountsServer: body.accounts_server,
      dataCenter: body.data_center,
    });

    return {
      refresh_token: result.refresh_token,
      api_domain: result.api_domain,
    };
  }

  /**
   * Exchange a self-client grant token for tokens.
   * Alternative to the redirect flow — user generates a grant token
   * in Zoho API Console and pastes it here.
   */
  @Post('exchange-grant-token')
  async exchangeGrantToken(@Body() body: ExchangeGrantTokenDto) {
    const result = await this.zohoOAuthService.exchangeGrantToken({
      grantToken: body.grant_token,
      clientId: body.client_id,
      clientSecret: body.client_secret,
      dataCenter: body.data_center,
    });

    return {
      refresh_token: result.refresh_token,
      api_domain: result.api_domain,
    };
  }
}
