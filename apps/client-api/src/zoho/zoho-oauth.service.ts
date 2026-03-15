import { Injectable, Logger, BadRequestException } from '@nestjs/common';

/** Zoho data center configuration */
interface ZohoDataCenter {
  label: string;
  accountsUrl: string;
  apiDomain: string;
}

const ZOHO_DATA_CENTERS: Record<string, ZohoDataCenter> = {
  us: { label: 'United States', accountsUrl: 'https://accounts.zoho.com', apiDomain: 'https://www.zohoapis.com' },
  eu: { label: 'Europe', accountsUrl: 'https://accounts.zoho.eu', apiDomain: 'https://www.zohoapis.eu' },
  in: { label: 'India', accountsUrl: 'https://accounts.zoho.in', apiDomain: 'https://www.zohoapis.in' },
  au: { label: 'Australia', accountsUrl: 'https://accounts.zoho.com.au', apiDomain: 'https://www.zohoapis.com.au' },
  jp: { label: 'Japan', accountsUrl: 'https://accounts.zoho.jp', apiDomain: 'https://www.zohoapis.jp' },
  ca: { label: 'Canada', accountsUrl: 'https://accounts.zohocloud.ca', apiDomain: 'https://www.zohoapis.ca' },
  uk: { label: 'United Kingdom', accountsUrl: 'https://accounts.zoho.uk', apiDomain: 'https://www.zohoapis.uk' },
};

const DEFAULT_SCOPES = [
  'ZohoCRM.modules.accounts.READ',
  'ZohoCRM.modules.salesorders.READ',
];

export interface ZohoAuthUrlParams {
  clientId: string;
  redirectUri: string;
  dataCenter?: string;
  scopes?: string[];
}

export interface ZohoTokenExchangeParams {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** The accounts-server URL returned by Zoho in the callback */
  accountsServer?: string;
  dataCenter?: string;
}

export interface ZohoTokenExchangeResult {
  refresh_token: string;
  access_token: string;
  api_domain: string;
  token_type: string;
  expires_in: number;
}

export interface ZohoGrantTokenExchangeParams {
  grantToken: string;
  clientId: string;
  clientSecret: string;
  dataCenter?: string;
}

@Injectable()
export class ZohoOAuthService {
  private readonly logger = new Logger(ZohoOAuthService.name);

  /**
   * Get available Zoho data centers
   */
  getDataCenters(): Record<string, { label: string; accountsUrl: string }> {
    return Object.fromEntries(
      Object.entries(ZOHO_DATA_CENTERS).map(([key, dc]) => [
        key,
        { label: dc.label, accountsUrl: dc.accountsUrl },
      ]),
    );
  }

  /**
   * Build the Zoho OAuth2 authorization URL
   */
  buildAuthUrl(params: ZohoAuthUrlParams): string {
    const dc = params.dataCenter || 'us';
    const dataCenter = ZOHO_DATA_CENTERS[dc];
    if (!dataCenter) {
      throw new BadRequestException(`Invalid data center: ${dc}. Valid: ${Object.keys(ZOHO_DATA_CENTERS).join(', ')}`);
    }

    const scopes = params.scopes ?? DEFAULT_SCOPES;

    const query = new URLSearchParams({
      response_type: 'code',
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      scope: scopes.join(','),
      access_type: 'offline',
      prompt: 'consent',
    });

    return `${dataCenter.accountsUrl}/oauth/v2/auth?${query.toString()}`;
  }

  /**
   * Exchange an authorization code for tokens (redirect flow)
   */
  async exchangeCodeForTokens(params: ZohoTokenExchangeParams): Promise<ZohoTokenExchangeResult> {
    // Use the accounts-server from the callback if available (respects user's data center)
    // Otherwise fall back to the configured data center
    let tokenUrl: string;
    if (params.accountsServer) {
      tokenUrl = `${params.accountsServer.replace(/\/$/, '')}/oauth/v2/token`;
    } else {
      const dc = params.dataCenter || 'us';
      const dataCenter = ZOHO_DATA_CENTERS[dc];
      if (!dataCenter) {
        throw new BadRequestException(`Invalid data center: ${dc}`);
      }
      tokenUrl = `${dataCenter.accountsUrl}/oauth/v2/token`;
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      code: params.code,
    });

    this.logger.log(`Exchanging authorization code at: ${tokenUrl}`);

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const data = await response.json() as Record<string, unknown>;

    if (data['error']) {
      throw new BadRequestException(
        `Zoho token exchange failed: ${data['error']}`,
      );
    }

    if (!data['refresh_token']) {
      throw new BadRequestException(
        'No refresh_token returned. Ensure access_type=offline and prompt=consent were used.',
      );
    }

    return {
      refresh_token: data['refresh_token'] as string,
      access_token: data['access_token'] as string,
      api_domain: data['api_domain'] as string,
      token_type: data['token_type'] as string,
      expires_in: data['expires_in'] as number,
    };
  }

  /**
   * Exchange a self-client grant token for tokens
   */
  async exchangeGrantToken(params: ZohoGrantTokenExchangeParams): Promise<ZohoTokenExchangeResult> {
    const dc = params.dataCenter || 'us';
    const dataCenter = ZOHO_DATA_CENTERS[dc];
    if (!dataCenter) {
      throw new BadRequestException(`Invalid data center: ${dc}`);
    }

    const tokenUrl = `${dataCenter.accountsUrl}/oauth/v2/token`;

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.grantToken,
    });

    this.logger.log(`Exchanging grant token at: ${tokenUrl}`);

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const data = await response.json() as Record<string, unknown>;

    if (data['error']) {
      throw new BadRequestException(
        `Zoho grant token exchange failed: ${data['error']}`,
      );
    }

    if (!data['refresh_token']) {
      throw new BadRequestException(
        'No refresh_token returned. The grant token may have expired (valid for 2-3 minutes) or already been used.',
      );
    }

    return {
      refresh_token: data['refresh_token'] as string,
      access_token: data['access_token'] as string,
      api_domain: data['api_domain'] as string,
      token_type: data['token_type'] as string,
      expires_in: data['expires_in'] as number,
    };
  }
}
