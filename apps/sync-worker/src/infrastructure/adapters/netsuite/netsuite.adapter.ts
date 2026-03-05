import { Injectable, Logger } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import {
  DataSourcePort,
  FetchOptions,
  FetchResult,
  RawAccountData,
  RawOrderData,
} from '../../../domain/ports/data-source.port.js';

export interface NetsuiteConfig {
  authType: 'oauth1' | 'oauth2';
  restletHost: string;
  account: string;
  deployId: number;
  orderScriptId: string;
  accountScriptId: string;
  
  // OAuth 2.0 fields
  clientId?: string;
  certificateId?: string;
  privateKey?: string;
  
  // OAuth 1.0a fields
  consumerKey?: string;
  consumerSecret?: string;
  token?: string;
  tokenSecret?: string;
  realm?: string;
}

@Injectable()
export class NetsuiteAdapter implements DataSourcePort {
  private readonly logger = new Logger(NetsuiteAdapter.name);
  private config: NetsuiteConfig | null = null;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  /**
   * Configure the adapter with NetSuite credentials
   */
  configure(config: NetsuiteConfig): void {
    this.config = config;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  async fetchAccounts(options?: FetchOptions): Promise<FetchResult<RawAccountData>> {
    this.ensureConfigured();
    
    const params: Record<string, string> = {
      type: 'customers',
      realm: this.config!.account,
    };

    if (options?.lastModified) {
      params['last_modified'] = options.lastModified.toISOString().split('T')[0];
    }

    const response = await this.makeRequest('GET', this.config!.accountScriptId, params);
    
    const data = Array.isArray(response) ? response : (response?.data ?? response?.results ?? []);
    
    return {
      data: data as RawAccountData[],
      hasMore: false, // NetSuite RESTlet typically returns all matching records
      totalCount: data.length,
    };
  }

  async fetchOrders(options?: FetchOptions): Promise<FetchResult<RawOrderData>> {
    this.ensureConfigured();
    
    const params: Record<string, string> = {
      type: 'orders',
      realm: this.config!.account,
    };

    if (options?.lastModified) {
      params['last_modified'] = options.lastModified.toISOString().split('T')[0];
    }

    const response = await this.makeRequest('GET', this.config!.orderScriptId, params);
    
    const data = Array.isArray(response) ? response : (response?.data ?? response?.results ?? []);
    
    return {
      data: data as RawOrderData[],
      hasMore: false,
      totalCount: data.length,
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      this.ensureConfigured();
      // Try to fetch a small batch of accounts to test
      await this.fetchAccounts({ limit: 1 });
      return true;
    } catch (error) {
      this.logger.error(`Connection test failed: ${error}`);
      return false;
    }
  }

  private ensureConfigured(): void {
    if (!this.config) {
      throw new Error('NetSuite adapter not configured. Call configure() first.');
    }
  }

  private async makeRequest(
    method: 'GET' | 'POST',
    scriptId: string,
    params?: Record<string, string>
  ): Promise<unknown> {
    this.ensureConfigured();
    
    let url = `${this.config!.restletHost}?script=${scriptId}&deploy=${this.config!.deployId}`;
    
    if (params && method === 'GET') {
      const queryParams = new URLSearchParams(params);
      url += `&${queryParams.toString()}`;
    }

    const headers = await this.getAuthHeaders(method, url);
    headers['Content-Type'] = 'application/json';

    this.logger.debug(`Making ${method} request to: ${url}`);

    const response = await fetch(url, {
      method,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`NetSuite API error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  private async getAuthHeaders(method: string, url: string): Promise<Record<string, string>> {
    if (this.config!.authType === 'oauth2') {
      const token = await this.getOAuth2Token();
      return { 'Authorization': `Bearer ${token}` };
    } else {
      return this.getOAuth1Headers(method, url);
    }
  }

  private async getOAuth2Token(): Promise<string> {
    // Check if we have a valid cached token
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }

    const tokenUrl = this.getTokenUrl();
    const clientAssertion = this.createClientAssertion();

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: clientAssertion,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error(`Token request failed: ${response.status}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in * 1000);

    return this.accessToken;
  }

  private getTokenUrl(): string {
    const account = this.config!.account.toLowerCase().replace('_', '-');
    return `https://${account}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;
  }

  private createClientAssertion(): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: this.config!.clientId,
      sub: this.config!.clientId,
      aud: this.getTokenUrl(),
      iat: now,
      exp: now + 300,
      scope: ['restlets', 'rest_webservices'],
    };

    return jwt.sign(payload, this.config!.privateKey!, {
      algorithm: 'RS256',
      header: { alg: 'RS256', typ: 'JWT', kid: this.config!.certificateId },
    });
  }

  private getOAuth1Headers(method: string, url: string): Record<string, string> {
    // OAuth 1.0a implementation would go here
    // For now, return empty - full implementation in netsuite-api-client
    this.logger.warn('OAuth 1.0a not fully implemented in adapter');
    return {};
  }
}

