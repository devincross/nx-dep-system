import { Injectable, Logger } from '@nestjs/common';
import {
  DataSourcePort,
  FetchOptions,
  FetchResult,
  RawAccountData,
  RawOrderData,
} from '../../../domain/ports/data-source.port.js';

// Zoho's Get Records `fields` param is capped; keep the list bounded.
const MAX_FIELDS = 50;

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
  private tokenExpiresAt = 0;
  private readonly fieldsByModule = new Map<string, string>();

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

    if (options?.limit) {
      params['per_page'] = String(options.limit);
    }

    // Explicit page → single-page fetch; otherwise auto-paginate
    if (options?.page) {
      params['page'] = String(options.page);
      const response = await this.makeRequest('GET', this.config!.accountsModule, params, options?.lastModified);
      const data = response?.data ?? [];
      const info = response?.info ?? {};
      return {
        data: data as RawAccountData[],
        hasMore: info.more_records ?? false,
        totalCount: info.count,
      };
    }

    const { data, totalCount } = await this.fetchAllPages(this.config!.accountsModule, params, options?.lastModified);
    return { data: data as RawAccountData[], hasMore: false, totalCount };
  }

  async fetchOrders(options?: FetchOptions): Promise<FetchResult<RawOrderData>> {
    this.ensureConfigured();

    const params: Record<string, string> = {};

    if (options?.limit) {
      params['per_page'] = String(options.limit);
    }

    // Explicit page → single-page fetch; otherwise auto-paginate
    if (options?.page) {
      params['page'] = String(options.page);
      const response = await this.makeRequest('GET', this.config!.ordersModule, params, options?.lastModified);
      const data = response?.data ?? [];
      const info = response?.info ?? {};
      return {
        data: data as RawOrderData[],
        hasMore: info.more_records ?? false,
        totalCount: info.count,
      };
    }

    const { data, totalCount } = await this.fetchAllPages(this.config!.ordersModule, params, options?.lastModified);
    return { data: data as RawOrderData[], hasMore: false, totalCount };
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

  /**
   * Auto-paginate through all Zoho API pages for a module.
   */
  private async fetchAllPages(
    module: string,
    params: Record<string, string>,
    lastModified?: Date,
  ): Promise<{ data: unknown[]; totalCount: number }> {
    const allData: unknown[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      params['page'] = String(page);
      if (!params['per_page']) {
        params['per_page'] = '200'; // Zoho max per page
      }

      const response = await this.makeRequest('GET', module, params, lastModified);
      const data = response?.data ?? [];
      const info = response?.info ?? {};

      allData.push(...(data as unknown[]));
      hasMore = info.more_records ?? false;
      page++;

      if (page > 500) {
        this.logger.warn(`Pagination safety limit reached for module ${module} at page ${page}`);
        break;
      }
    }

    return { data: allData, totalCount: allData.length };
  }

  private ensureConfigured(): void {
    if (!this.config) {
      throw new Error('Zoho adapter not configured. Call configure() first.');
    }
  }

  private async makeRequest(
    method: 'GET' | 'POST',
    module: string,
    params?: Record<string, string>,
    lastModified?: Date,
  ): Promise<{ data?: unknown[]; info?: { more_records?: boolean; count?: number } }> {
    this.ensureConfigured();

    const token = await this.getAccessToken();
    let url = `${this.config!.apiDomain}/crm/v3/${module}`;

    if (method === 'GET') {
      // The Get Records API requires an explicit `fields` list.
      const queryParams = new URLSearchParams(params ?? {});
      queryParams.set('fields', await this.resolveFields(module));
      url += `?${queryParams.toString()}`;
    }

    const headers: Record<string, string> = {
      'Authorization': `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
    };
    // The Get Records API has no `criteria` param; filter by last-modified
    // via the If-Modified-Since header instead.
    if (lastModified) {
      headers['If-Modified-Since'] = lastModified.toISOString();
    }

    this.logger.debug(`Making ${method} request to: ${url}`);

    const response = await fetch(url, { method, headers });

    // 204 = no records; 304 = nothing modified since lastModified.
    if (response.status === 204 || response.status === 304) {
      return { data: [], info: { more_records: false, count: 0 } };
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Zoho API error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<{ data?: unknown[]; info?: { more_records?: boolean; count?: number } }>;
  }

  /**
   * Resolve a module's field api_names for the Get Records `fields` param.
   * Cached per module; falls back to 'id' on any failure.
   */
  private async resolveFields(module: string): Promise<string> {
    const cached = this.fieldsByModule.get(module);
    if (cached) return cached;

    let result = 'id';
    try {
      const token = await this.getAccessToken();
      const resp = await fetch(
        `${this.config!.apiDomain}/crm/v3/settings/fields?module=${encodeURIComponent(module)}`,
        { headers: { Authorization: `Zoho-oauthtoken ${token}` } },
      );
      if (resp.ok) {
        const body = (await resp.json().catch(() => null)) as
          | { fields?: Array<{ api_name?: string }> }
          | null;
        const names = (body?.fields ?? [])
          .map((f) => f.api_name)
          .filter((n): n is string => !!n);
        // Zoho's Get Records `fields` param is capped at 50.
        if (names.length) result = names.slice(0, MAX_FIELDS).join(',');
      }
    } catch {
      result = 'id';
    }

    this.fieldsByModule.set(module, result);
    return result;
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

