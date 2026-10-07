import { Injectable, NotFoundException, Logger } from '@nestjs/common';
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

@Injectable()
export class ZohoService {
  private readonly logger = new Logger(ZohoService.name);

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
   * Make an authenticated GET against a Zoho CRM module and normalise the result.
   */
  private async readModule(
    data: ZohoConnectionData,
    module: string,
    params?: Record<string, string>
  ): Promise<ZohoResponse> {
    try {
      const token = await this.getAccessToken(data);
      const apiDomain = data.api_domain || DEFAULT_API_DOMAIN;
      const query = params ? `?${new URLSearchParams(params).toString()}` : '';
      const resp = await fetch(`${apiDomain}/crm/v3/${module}${query}`, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      });

      // 204 = module readable but no records match.
      if (resp.status === 204) {
        return { success: true, data: { data: [], info: { count: 0 } } };
      }

      const body = (await resp.json().catch(() => null)) as
        | { message?: string; code?: string }
        | null;

      if (!resp.ok) {
        return {
          success: false,
          error: body?.message || body?.code || `HTTP ${resp.status}`,
        };
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
   * Verify the connection by reading a single record from the orders module.
   */
  async testConnection(db: TenantDb): Promise<{ success: boolean; message: string }> {
    const credential = await this.getZohoCredential(db);
    const data = credential.connectionData as ZohoConnectionData;
    const ordersModule = data.orders_module || DEFAULT_ORDERS_MODULE;
    const result = await this.readModule(data, ordersModule, { fields: 'id', per_page: '1' });
    return result.success
      ? { success: true, message: `Connected to Zoho — the ${ordersModule} module is readable.` }
      : { success: false, message: result.error || 'Zoho connection test failed.' };
  }

  async getOrders(db: TenantDb, query: { since?: string; per_page?: string }): Promise<ZohoResponse> {
    const credential = await this.getZohoCredential(db);
    const data = credential.connectionData as ZohoConnectionData;
    return this.readModule(data, data.orders_module || DEFAULT_ORDERS_MODULE, this.buildParams(query));
  }

  async getAccounts(db: TenantDb, query: { since?: string; per_page?: string }): Promise<ZohoResponse> {
    const credential = await this.getZohoCredential(db);
    const data = credential.connectionData as ZohoConnectionData;
    return this.readModule(data, data.accounts_module || DEFAULT_ACCOUNTS_MODULE, this.buildParams(query));
  }

  async fetchModule(
    db: TenantDb,
    module: string,
    query: { since?: string; per_page?: string }
  ): Promise<ZohoResponse> {
    const credential = await this.getZohoCredential(db);
    const data = credential.connectionData as ZohoConnectionData;
    return this.readModule(data, module, this.buildParams(query));
  }

  /**
   * Translate the portal's simple query into Zoho CRM params.
   * `since` filters by last-modified; per_page caps the page size (Zoho max 200).
   */
  private buildParams(query: { since?: string; per_page?: string }): Record<string, string> {
    const params: Record<string, string> = {
      per_page: query.per_page || '50',
    };
    if (query.since) {
      params['criteria'] = `(Modified_Time:greater_than:${new Date(query.since).toISOString()})`;
    }
    return params;
  }
}
