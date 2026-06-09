import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ZohoOAuthService } from './zoho-oauth.service.js';

class AuthUrlQueryDto {
  client_id!: string;
  redirect_uri!: string;
  data_center?: string;
  scopes?: string;
}

class ExchangeCodeDto {
  code!: string;
  client_id!: string;
  client_secret!: string;
  redirect_uri!: string;
  accounts_server?: string;
  data_center?: string;
}

class ExchangeGrantTokenDto {
  grant_token!: string;
  client_id!: string;
  client_secret!: string;
  data_center?: string;
}

@Controller('zoho')
@UseGuards(JwtAuthGuard)
export class ZohoController {
  constructor(private readonly zohoOAuthService: ZohoOAuthService) {}

  /**
   * Get available Zoho data centers
   */
  @Get('data-centers')
  getDataCenters() {
    return this.zohoOAuthService.getDataCenters();
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
