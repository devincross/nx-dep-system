import { Injectable, Logger } from '@nestjs/common';
import {
  DataSourcePort,
  FetchOptions,
  FetchResult,
  RawAccountData,
  RawOrderData,
} from '../../../domain/ports/data-source.port.js';

export interface ZohoConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  apiDomain: string; // e.g., https://www.zohoapis.com
  accountsModule: string; // e.g., 'Accounts'
  ordersModule: string; // e.g., 'Sales_Orders'
}

@Injectable()
export class ZohoAdapter implements DataSourcePort {
  private readonly logger = new Logger(ZohoAdapter.name);
  private config: ZohoConfig | null = null;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  /**
   * Configure the adapter with Zoho credentials
   */
  configure(config: ZohoConfig): void {
    this.config = config;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  async fetchAccounts(options?: FetchOptions): Promise<FetchResult<RawAccountData>> {
    this.ensureConfigured();
    
    const params: Record<string, string> = {};
    
    if (options?.lastModified) {
      // Zoho uses Modified_Time for filtering
      params['criteria'] = `(Modified_Time:greater_than:${options.lastModified.toISOString()})`;
    }
    
    if (options?.limit) {
      params['per_page'] = String(options.limit);
    }
    
    if (options?.page) {
      params['page'] = String(options.page);
    }

    const response = await this.makeRequest('GET', this.config!.accountsModule, params);
    
    const data = response?.data ?? [];
    const info = response?.info ?? {};
    
    return {
      data: data as RawAccountData[],
      hasMore: info.more_records ?? false,
      totalCount: info.count,
    };
  }

  async fetchOrders(options?: FetchOptions): Promise<FetchResult<RawOrderData>> {
    this.ensureConfigured();
    
    const params: Record<string, string> = {};
    
    if (options?.lastModified) {
      params['criteria'] = `(Modified_Time:greater_than:${options.lastModified.toISOString()})`;
    }
    
    if (options?.limit) {
      params['per_page'] = String(options.limit);
    }
    
    if (options?.page) {
      params['page'] = String(options.page);
    }

    const response = await this.makeRequest('GET', this.config!.ordersModule, params);
    
    const data = response?.data ?? [];
    const info = response?.info ?? {};
    
    return {
      data: data as RawOrderData[],
      hasMore: info.more_records ?? false,
      totalCount: info.count,
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      this.ensureConfigured();
      await this.getAccessToken();
      return true;
    } catch (error) {
      this.logger.error(`Connection test failed: ${error}`);
      return false;
    }
  }

  private ensureConfigured(): void {
    if (!this.config) {
      throw new Error('Zoho adapter not configured. Call configure() first.');
    }
  }

  private async makeRequest(
    method: 'GET' | 'POST',
    module: string,
    params?: Record<string, string>
  ): Promise<{ data?: unknown[]; info?: { more_records?: boolean; count?: number } }> {
    this.ensureConfigured();
    
    const token = await this.getAccessToken();
    let url = `${this.config!.apiDomain}/crm/v3/${module}`;
    
    if (params && method === 'GET') {
      const queryParams = new URLSearchParams(params);
      url += `?${queryParams.toString()}`;
    }

    this.logger.debug(`Making ${method} request to: ${url}`);

    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Zoho API error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  private async getAccessToken(): Promise<string> {
    // Check if we have a valid cached token
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }

    const tokenUrl = 'https://accounts.zoho.com/oauth/v2/token';
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.config!.clientId,
      client_secret: this.config!.clientSecret,
      refresh_token: this.config!.refreshToken,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in * 1000);

    return this.accessToken;
  }
}

