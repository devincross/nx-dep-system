import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
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
  private tokenExpiresAt = 0;

  /**
   * Configure the adapter with NetSuite credentials
   */
  configure(config: NetsuiteConfig): void {
    this.config = config;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  /**
   * Build a configured adapter from a credential's decrypted connection data.
   */
  static fromConnectionData(data: Record<string, unknown>): NetsuiteAdapter {
    const adapter = new NetsuiteAdapter();
    adapter.configure({
      authType: (data['auth_type'] as 'oauth1' | 'oauth2') || 'oauth1',
      restletHost: data['netsuite_restlet_host'] as string,
      account: data['netsuite_account'] as string,
      deployId: data['netsuite_deploy_id'] as number,
      orderScriptId: data['netsuite_order_script_id'] as string,
      accountScriptId: data['netsuite_account_script_id'] as string,
      clientId: data['client_id'] as string,
      certificateId: data['certificate_id'] as string,
      privateKey: data['private_key'] as string,
      consumerKey: data['netsuite_consumer_key'] as string,
      consumerSecret: data['netsuite_consumer_secret'] as string,
      token: data['netsuite_token'] as string,
      tokenSecret: data['netsuite_token_secret'] as string,
      realm: data['netsuite_realm'] as string,
    });
    return adapter;
  }

  async fetchAccounts(options?: FetchOptions): Promise<FetchResult<RawAccountData>> {
    this.ensureConfigured();

    const params: Record<string, string> = {
      type: 'customers',
      realm: this.config!.account,
      last_modified: (options?.lastModified ?? new Date(0)).toISOString().split('T')[0],
    };

    const response = await this.makeRequest('GET', this.config!.accountScriptId, params);
    
    const wrapped = response as { data?: unknown[]; results?: unknown[] } | undefined;
    const data = Array.isArray(response) ? response : (wrapped?.data ?? wrapped?.results ?? []);
    
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
      last_modified: (options?.lastModified ?? new Date(0)).toISOString().split('T')[0],
    };

    const response = await this.makeRequest('GET', this.config!.orderScriptId, params);
    
    const wrapped = response as { data?: unknown[]; results?: unknown[] } | undefined;
    const data = Array.isArray(response) ? response : (wrapped?.data ?? wrapped?.results ?? []);
    
    return {
      data: data as RawOrderData[],
      hasMore: false,
      totalCount: data.length,
    };
  }

  /**
   * Push a DEP outcome back to the NetSuite order via the order RESTlet.
   * Contract (same as the legacy system): PUT { order_id, dep_response, dep_status }.
   */
  async updateOrderDepStatus(
    externalOrderId: string,
    depResponse: string,
    depStatus: string,
  ): Promise<void> {
    this.ensureConfigured();

    await this.makeRequest(
      'PUT',
      this.config!.orderScriptId,
      { realm: this.config!.account },
      {
        order_id: externalOrderId,
        dep_response: depResponse,
        dep_status: depStatus,
      },
    );
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
    method: 'GET' | 'POST' | 'PUT',
    scriptId: string,
    params?: Record<string, string>,
    body?: unknown
  ): Promise<unknown> {
    this.ensureConfigured();

    let url = `${this.config!.restletHost}?script=${scriptId}&deploy=${this.config!.deployId}`;

    if (params) {
      const queryParams = new URLSearchParams(params);
      url += `&${queryParams.toString()}`;
    }

    const headers = await this.getAuthHeaders(method, url);
    headers['Content-Type'] = 'application/json';

    this.logger.debug(`Making ${method} request to: ${url}`);

    const response = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' && body !== undefined ? JSON.stringify(body) : undefined,
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
      aud: this.getTokenUrl(),
      iat: now,
      exp: now + 300,
      scope: 'restlets',
    };

    return jwt.sign(payload, this.config!.privateKey!, {
      algorithm: 'PS256',
      header: { alg: 'PS256', typ: 'JWT', kid: this.config!.certificateId },
    });
  }

  /**
   * OAuth 1.0a (TBA) signing — mirrors the working client-api implementation.
   */
  private getOAuth1Headers(method: string, url: string): Record<string, string> {
    // NetSuite requires the OAuth realm to be the account ID in canonical
    // form: uppercase with underscores (e.g. 4325477_SB1). Stored values
    // sometimes hold the URL/domain form (4325477-sb1), which NetSuite
    // rejects with INVALID_LOGIN_ATTEMPT. Normalize defensively.
    const rawRealm = this.config!.realm || this.config!.account;
    const realm = rawRealm.toUpperCase().replace(/-/g, '_');

    const consumerKey = this.config!.consumerKey!;
    const consumerSecret = this.config!.consumerSecret!;
    const token = this.config!.token!;
    const tokenSecret = this.config!.tokenSecret!;

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomBytes(16).toString('hex');

    const urlObj = new URL(url);
    const baseUrl = `${urlObj.origin}${urlObj.pathname}`;

    // Collect all params (query + oauth)
    const params: [string, string][] = [];
    urlObj.searchParams.forEach((value, key) => {
      params.push([key, value]);
    });

    params.push(['oauth_consumer_key', consumerKey]);
    params.push(['oauth_nonce', nonce]);
    params.push(['oauth_signature_method', 'HMAC-SHA256']);
    params.push(['oauth_timestamp', timestamp]);
    params.push(['oauth_token', token]);
    params.push(['oauth_version', '1.0']);

    params.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

    const paramString = params
      .map(([k, v]) => `${this.percentEncode(k)}=${this.percentEncode(v)}`)
      .join('&');

    const signatureBase = `${method.toUpperCase()}&${this.percentEncode(baseUrl)}&${this.percentEncode(paramString)}`;
    const signingKey = `${this.percentEncode(consumerSecret)}&${this.percentEncode(tokenSecret)}`;
    const signature = crypto
      .createHmac('sha256', signingKey)
      .update(signatureBase)
      .digest('base64');

    const headerParts = [
      `realm="${this.percentEncode(realm)}"`,
      `oauth_consumer_key="${this.percentEncode(consumerKey)}"`,
      `oauth_nonce="${this.percentEncode(nonce)}"`,
      `oauth_signature="${this.percentEncode(signature)}"`,
      `oauth_signature_method="HMAC-SHA256"`,
      `oauth_timestamp="${timestamp}"`,
      `oauth_token="${this.percentEncode(token)}"`,
      `oauth_version="1.0"`,
    ];

    return { Authorization: `OAuth ${headerParts.join(', ')}` };
  }

  /**
   * Percent-encode per OAuth 1.0a spec (RFC 5849)
   */
  private percentEncode(str: string): string {
    return encodeURIComponent(str)
      .replace(/!/g, '%21')
      .replace(/\*/g, '%2A')
      .replace(/'/g, '%27')
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29');
  }
}

