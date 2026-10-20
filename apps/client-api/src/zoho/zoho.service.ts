import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TenantDb } from '@org/database';
import { CredentialsService, DecryptedCredential } from '../credentials/credentials.service.js';
import {
  zohoOrderFieldNames,
  zohoAccountFieldNames,
  pickFields,
  type ZohoFieldMappings,
} from './zoho-fields.util.js';

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
   * Resolve the module's field api_names. The Get Records API requires an
   * explicit `fields` list, so we read the module's field metadata first.
   */
  private async resolveFields(
    apiDomain: string,
    module: string,
    token: string,
    needed: string[] = [],
  ): Promise<string> {
    try {
      const resp = await fetch(
        `${apiDomain}/crm/v3/settings/fields?module=${encodeURIComponent(module)}`,
        { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
      );
      if (!resp.ok) {
        this.logger.warn(
          `Could not read field metadata for ${module} (HTTP ${resp.status}) — ` +
          `records will return only 'id'. The Zoho token likely lacks the ` +
          `ZohoCRM.settings.fields.READ scope; reconnect with that scope added.`,
        );
        return 'id';
      }
      const body = (await resp.json().catch(() => null)) as
        | { fields?: Array<{ api_name?: string }> }
        | null;
      const existing = new Set(
        (body?.fields ?? [])
          .map((f) => f.api_name)
          .filter((n): n is string => !!n),
      );
      // Needed fields first (so the 50-cap can't drop them), then fill the rest.
      return pickFields(needed, existing, MAX_FIELDS);
    } catch (err) {
      this.logger.warn(`Field metadata lookup for ${module} failed: ${err}`);
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
    query: { since?: string; per_page?: string },
    needed: string[] = [],
  ): Promise<ZohoResponse> {
    try {
      const token = await this.getAccessToken(data);
      const apiDomain = data.api_domain || DEFAULT_API_DOMAIN;
      const fields = await this.resolveFields(apiDomain, module, token, needed);

      const params = new URLSearchParams({ fields, per_page: query.per_page || '50' });
      const headers: Record<string, string> = { Authorization: `Zoho-oauthtoken ${token}` };
      if (query.since) {
        // Zoho wants ISO 8601 with a numeric offset and no milliseconds; the
        // default `.000Z` form is silently ignored (returns all records).
        headers['If-Modified-Since'] = new Date(query.since).toISOString().replace(/\.\d{3}Z$/, '+00:00');
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

  /** The tenant's field_mappings from the raw connection data. */
  private fieldMappings(credential: DecryptedCredential): ZohoFieldMappings | undefined {
    return (credential.connectionData as Record<string, unknown>)['field_mappings'] as
      | ZohoFieldMappings
      | undefined;
  }

  async getOrders(db: TenantDb, query: { since?: string; per_page?: string }): Promise<ZohoResponse> {
    const credential = await this.getZohoCredential(db);
    const data = credential.connectionData as unknown as ZohoConnectionData;
    return this.readRecords(
      data,
      data.orders_module || DEFAULT_ORDERS_MODULE,
      query,
      zohoOrderFieldNames(this.fieldMappings(credential)),
    );
  }

  async getAccounts(db: TenantDb, query: { since?: string; per_page?: string }): Promise<ZohoResponse> {
    const credential = await this.getZohoCredential(db);
    const data = credential.connectionData as unknown as ZohoConnectionData;
    return this.readRecords(
      data,
      data.accounts_module || DEFAULT_ACCOUNTS_MODULE,
      query,
      zohoAccountFieldNames(this.fieldMappings(credential)),
    );
  }

  /**
   * Fetch and map every account for an account sync. Cursor-paginates the full
   * accounts module and maps each record with the tenant's field_mappings.account
   * config (defaults: id / Account_Name / DEP_Account_ID).
   */
  async getMappedAccounts(
    db: TenantDb,
  ): Promise<Array<{ externalAccountId: string; name: string; depAccountId?: string }>> {
    const credential = await this.getZohoCredential(db);
    const data = credential.connectionData as unknown as ZohoConnectionData;
    const module = data.accounts_module || DEFAULT_ACCOUNTS_MODULE;

    const cfg =
      ((credential.connectionData as Record<string, unknown>)['field_mappings'] as
        | { account?: Record<string, string> }
        | undefined)?.account ?? {};
    const idField = cfg.externalAccountId || 'id';
    const nameField = cfg.name || 'Account_Name';
    const depField = cfg.depAccountId || 'DEP_Account_ID';

    const records = await this.readAllRecords(data, module, zohoAccountFieldNames(this.fieldMappings(credential)));
    return records
      .map((r) => {
        const dep = this.fieldPath(r, depField);
        return {
          externalAccountId: String(this.fieldPath(r, idField) ?? ''),
          name: String(this.fieldPath(r, nameField) ?? ''),
          depAccountId: dep != null ? String(dep) : undefined,
        };
      })
      .filter((a) => a.externalAccountId);
  }

  /** Resolve a (possibly dot-notated) field path on a record. */
  private fieldPath(obj: Record<string, unknown>, path: string): unknown {
    return path
      .split('.')
      .reduce<unknown>(
        (cur, part) =>
          cur != null && typeof cur === 'object'
            ? (cur as Record<string, unknown>)[part]
            : undefined,
        obj,
      );
  }

  /** Read every record in a module via cursor pagination (page_token). */
  private async readAllRecords(
    data: ZohoConnectionData,
    module: string,
    needed: string[] = [],
  ): Promise<Record<string, unknown>[]> {
    const token = await this.getAccessToken(data);
    const apiDomain = data.api_domain || DEFAULT_API_DOMAIN;
    const fields = await this.resolveFields(apiDomain, module, token, needed);

    const all: Record<string, unknown>[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    do {
      const params = new URLSearchParams({ fields, per_page: '200' });
      if (pageToken) params.set('page_token', pageToken);
      const resp = await fetch(`${apiDomain}/crm/v3/${module}?${params.toString()}`, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      });
      if (resp.status === 204) break;
      if (!resp.ok) {
        const b = (await resp.json().catch(() => null)) as { message?: string; code?: string } | null;
        throw new Error(b?.message || b?.code || `Zoho ${module} fetch failed (HTTP ${resp.status})`);
      }
      const body = (await resp.json()) as {
        data?: Record<string, unknown>[];
        info?: { next_page_token?: string };
      };
      all.push(...(body.data ?? []));
      pageToken = body.info?.next_page_token;
      if (++pages > 500) break;
    } while (pageToken);

    return all;
  }
}
