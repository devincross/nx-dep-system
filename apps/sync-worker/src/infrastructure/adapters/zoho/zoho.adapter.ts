import { Injectable, Logger } from '@nestjs/common';
import {
  DataSourcePort,
  FetchOptions,
  FetchResult,
  RawAccountData,
  RawOrderData,
} from '../../../domain/ports/data-source.port.js';
import { ErpOrderWriteback } from '../../../domain/ports/erp-writeback.port.js';
import {
  FieldMappingsConfig,
  zohoOrderFieldNames,
  zohoAccountFieldNames,
} from './mappers/dynamic.mapper.js';

// Zoho's Get Records `fields` param is capped; keep the list bounded.
const MAX_FIELDS = 50;

export interface ZohoConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  apiDomain: string; // e.g., https://www.zohoapis.com
  accountsModule: string; // e.g., 'Accounts'
  ordersModule: string; // e.g., 'Sales_Orders'
  // The tenant's field mappings, so the fetch can request exactly the fields
  // the mapper consumes (instead of the first 50 the module happens to return).
  fieldMappings?: FieldMappingsConfig;
  // API names of the order fields the DEP outcome is written back to.
  depStatusField?: string; // default 'DEP_Status'
  depResponseField?: string; // default 'DEP_Response'
}

@Injectable()
export class ZohoAdapter implements DataSourcePort, ErpOrderWriteback {
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
   * Push a resolved DEP outcome back to the Zoho order record. Writes the
   * status/response field pair via PUT (same contract as the client-api
   * manual push). Requires the token to hold a write scope
   * (ZohoCRM.modules.salesorders.UPDATE); throws on failure.
   */
  async updateOrderDepStatus(
    externalOrderId: string,
    depResponse: string,
    depStatus: string,
  ): Promise<void> {
    this.ensureConfigured();
    const token = await this.getAccessToken();
    const statusField = this.config!.depStatusField || 'DEP_Status';
    const responseField = this.config!.depResponseField || 'DEP_Response';

    const resp = await fetch(
      `${this.config!.apiDomain}/crm/v3/${this.config!.ordersModule}/${externalOrderId}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: [{ [statusField]: depStatus, [responseField]: depResponse.slice(0, 1000) }],
        }),
      },
    );

    const body = (await resp.json().catch(() => null)) as
      | { data?: { status?: string; message?: string }[] }
      | null;
    const recordResult = body?.data?.[0];
    if (!resp.ok || recordResult?.status === 'error') {
      throw new Error(`Zoho update failed: ${recordResult?.message || `HTTP ${resp.status}`}`);
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
    if (!params['per_page']) {
      params['per_page'] = '200'; // Zoho max per page
    }

    // Zoho caps offset pagination (`page`) at 2000 records — beyond that it
    // 400s with DISCRETE_PAGINATION_LIMIT_EXCEEDED. Use cursor pagination:
    // the first request omits both, then each subsequent request passes the
    // `next_page_token` from the previous response (mutually exclusive with
    // `page`).
    let pageToken: string | undefined;
    let pages = 0;

    do {
      if (pageToken) {
        params['page_token'] = pageToken;
      } else {
        delete params['page_token'];
      }

      const response = await this.makeRequest('GET', module, params, lastModified);
      const data = response?.data ?? [];
      const info = response?.info ?? {};

      allData.push(...(data as unknown[]));
      pageToken = info.next_page_token;

      if (++pages > 500) {
        this.logger.warn(`Pagination safety limit reached for module ${module} at ${pages} pages`);
        break;
      }
    } while (pageToken);

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
  ): Promise<{ data?: unknown[]; info?: { more_records?: boolean; count?: number; next_page_token?: string } }> {
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
    // via the If-Modified-Since header instead. Zoho wants ISO 8601 with a
    // numeric offset and no milliseconds (e.g. 2026-10-15T00:00:00+00:00);
    // the default `.000Z` form is silently ignored and returns all records.
    if (lastModified) {
      headers['If-Modified-Since'] = lastModified.toISOString().replace(/\.\d{3}Z$/, '+00:00');
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

    return response.json() as Promise<{ data?: unknown[]; info?: { more_records?: boolean; count?: number; next_page_token?: string } }>;
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
        const existing = new Set(
          (body?.fields ?? [])
            .map((f) => f.api_name)
            .filter((n): n is string => !!n),
        );
        // Request exactly the fields the mapper consumes (those that exist on
        // the module) so the 50-field cap can't drop Status/Account_Name/the
        // serial field/etc. Fall back to the first 50 fields when we have no
        // needed-list (unknown module).
        const needed =
          module === this.config!.ordersModule
            ? zohoOrderFieldNames(this.config!.fieldMappings)
            : module === this.config!.accountsModule
              ? zohoAccountFieldNames(this.config!.fieldMappings)
              : [];
        const wanted = needed.filter((n) => existing.has(n));
        if (wanted.length) {
          if (!wanted.includes('id') && existing.has('id')) wanted.unshift('id');
          result = wanted.slice(0, MAX_FIELDS).join(',');
        } else if (existing.size) {
          result = [...existing].slice(0, MAX_FIELDS).join(',');
        }
      } else {
        this.logger.warn(
          `Could not read field metadata for ${module} (HTTP ${resp.status}) — ` +
          `records will return only 'id'. Ensure the Zoho token has the ` +
          `ZohoCRM.settings.fields.READ scope.`,
        );
      }
    } catch (err) {
      this.logger.warn(`Field metadata lookup for ${module} failed: ${err}`);
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

