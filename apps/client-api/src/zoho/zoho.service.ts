import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantDb } from '@org/database';
import { CredentialsService, DecryptedCredential } from '../credentials/credentials.service.js';

/**
 * Zoho connection data interface matching ZohoConnectionDataDto.
 */
export interface ZohoConnectionData {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  api_domain?: string;
  accounts_module?: string;
  orders_module?: string;
}

/**
 * Response from Zoho CRM calls (mirrors NetsuiteResponse).
 */
export interface ZohoResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

const DEFAULT_API_DOMAIN = 'https://www.zohoapis.com';
const DEFAULT_ORDERS_MODULE = 'Sales_Orders';
const DEFAULT_ACCOUNTS_MODULE = 'Accounts';
const TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token';
// Zoho's Get Records `fields` param is capped; keep the list bounded for a test view.
const MAX_FIELDS = 50;

@Injectable()
export class ZohoService {
  constructor(private readonly credentialsService: CredentialsService) {}

  /**
   * Get the newest active Zoho credential for the tenant.
   */
  async getZohoCredential(db: TenantDb): Promise<DecryptedCredential> {
    const credential = await this.credentialsService.findNewestActiveByType(db, 'zoho');

    if (!credential) {
      throw new NotFoundException('No active Zoho credentials found');
    }

    return credential;
  }

  /**
   * Exchange the stored refresh token for a short-lived access token.
   */
  private async getAccessToken(data: ZohoConnectionData): Promise<string> {
    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: data.client_id,
        client_secret: data.client_secret,
        refresh_token: data.refresh_token,
      }).toString(),
    });
    const tok = (await resp.json().catch(() => null)) as
      | { access_token?: string; error?: string }
      | null;
    if (!tok?.access_token) {
      throw new Error(`Zoho token refresh failed: ${tok?.error || `HTTP ${resp.status}`}`);
    }
    return tok.access_token;
  }

  /**
   * Resolve the module's field api_names. The Get Records API requires an
   * explicit `fields` list, so we read the module's field metadata first.
   */
  private async resolveFields(apiDomain: string, module: string, token: string): Promise<string> {
    try {
      const resp = await fetch(
        `${apiDomain}/crm/v3/settings/fields?module=${encodeURIComponent(module)}`,
        { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
      );
      if (!resp.ok) return 'id';
      const body = (await resp.json().catch(() => null)) as
        | { fields?: Array<{ api_name?: string }> }
        | null;
      const names = (body?.fields ?? [])
        .map((f) => f.api_name)
        .filter((n): n is string => !!n);
      return names.length ? names.slice(0, MAX_FIELDS).join(',') : 'id';
    } catch {
      return 'id';
    }
  }

  /**
   * Read records from a module. `since` filters by last-modified via the
   * If-Modified-Since header (the Get Records API has no `criteria` param).
   */
  private async readRecords(
    data: ZohoConnectionData,
    module: string,
    query: { since?: string; per_page?: string }
  ): Promise<ZohoResponse> {
    try {
      const token = await this.getAccessToken(data);
      const apiDomain = data.api_domain || DEFAULT_API_DOMAIN;
      const fields = await this.resolveFields(apiDomain, module, token);

      const params = new URLSearchParams({ fields, per_page: query.per_page || '50' });
      const headers: Record<string, string> = { Authorization: `Zoho-oauthtoken ${token}` };
      if (query.since) {
        headers['If-Modified-Since'] = new Date(query.since).toISOString();
      }

      const resp = await fetch(`${apiDomain}/crm/v3/${module}?${params.toString()}`, { headers });

      // 204 = no records; 304 = nothing modified since the given date.
      if (resp.status === 204 || resp.status === 304) {
        return { success: true, data: { data: [], info: { count: 0 } } };
      }

      const body = (await resp.json().catch(() => null)) as
        | { message?: string; code?: string }
        | null;

      if (!resp.ok) {
        return { success: false, error: body?.message || body?.code || `HTTP ${resp.status}` };
      }

      return { success: true, data: body ?? undefined };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Credential status (without sensitive data).
   */
  async getStatus(db: TenantDb) {
    const credential = await this.getZohoCredential(db);
    return {
      id: credential.id,
      status: credential.status,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    };
  }

  /**
   * Verify the connection by reading a single id from the orders module.
   */
  async testConnection(db: TenantDb): Promise<{ success: boolean; message: string }> {
    const credential = await this.getZohoCredential(db);
    const data = credential.connectionData as unknown as ZohoConnectionData;
    const ordersModule = data.orders_module || DEFAULT_ORDERS_MODULE;
    try {
      const token = await this.getAccessToken(data);
      const apiDomain = data.api_domain || DEFAULT_API_DOMAIN;
      const resp = await fetch(
        `${apiDomain}/crm/v3/${ordersModule}?fields=id&per_page=1`,
        { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
      );
      if (resp.ok || resp.status === 204) {
        return { success: true, message: `Connected to Zoho — the ${ordersModule} module is readable.` };
      }
      const body = (await resp.json().catch(() => null)) as { message?: string; code?: string } | null;
      return {
        success: false,
        message: body?.message || body?.code || `Zoho rejected the request (HTTP ${resp.status}).`,
      };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async getOrders(db: TenantDb, query: { since?: string; per_page?: string }): Promise<ZohoResponse> {
    const credential = await this.getZohoCredential(db);
    const data = credential.connectionData as unknown as ZohoConnectionData;
    return this.readRecords(data, data.orders_module || DEFAULT_ORDERS_MODULE, query);
  }

  async getAccounts(db: TenantDb, query: { since?: string; per_page?: string }): Promise<ZohoResponse> {
    const credential = await this.getZohoCredential(db);
    const data = credential.connectionData as unknown as ZohoConnectionData;
    return this.readRecords(data, data.accounts_module || DEFAULT_ACCOUNTS_MODULE, query);
  }
}
