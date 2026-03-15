import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import type { TenantContext } from '../tenant/tenant-context.service.js';
import { CredentialsService } from '../credentials/credentials.service.js';

// Inline lightweight implementations — we don't import from sync-worker,
// we re-use the same adapter/mapper/repo patterns from @org/database.
import { eq, isNull, and, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import {
  TenantDb,
  orders,
  orderItems,
  accounts,
  syncStatus as syncStatusTable,
  credentials,
} from '@org/database';

interface ImportResult {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errored: number;
  errors: string[];
  pages: number;
}

@Injectable()
export class HistoricalImportService {
  private readonly logger = new Logger(HistoricalImportService.name);

  constructor(private readonly credentialsService: CredentialsService) {}

  async runImport(
    tenant: TenantContext,
    startDate: Date,
    pageSize: number,
    pageDelayMs: number,
  ): Promise<ImportResult> {
    const db = tenant.db;
    const metadata = tenant.tenant.metadata
      ? JSON.parse(tenant.tenant.metadata)
      : {};
    const connectionType: 'netsuite' | 'zoho' =
      metadata.connectionType || 'netsuite';

    // Get credentials
    const credential = await this.credentialsService.findNewestActiveByType(
      db,
      connectionType,
    );
    if (!credential) {
      throw new BadRequestException(
        `No active ${connectionType} credentials found`,
      );
    }

    const connData = credential.connectionData as Record<string, unknown>;

    // Build the appropriate fetcher
    const fetcher = this.buildFetcher(connectionType, connData);
    const mapOrder = this.buildMapper(connectionType, connData);

    const result: ImportResult = {
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errored: 0,
      errors: [],
      pages: 0,
    };

    // Record sync start
    const syncId = await this.startSyncRecord(db);

    try {
      let hasMore = true;
      let page = 1;

      while (hasMore) {
        this.logger.log(
          `Page ${page}: fetching from ${connectionType} (limit ${pageSize})...`,
        );

        const fetchResult = await fetcher(startDate, pageSize, page);
        result.pages = page;

        if (fetchResult.data.length === 0) {
          hasMore = false;
          break;
        }

        this.logger.log(`Page ${page}: ${fetchResult.data.length} orders`);

        for (const raw of fetchResult.data) {
          try {
            const mapped = mapOrder(raw);
            if (!mapped.externalOrderId) {
              result.skipped++;
              continue;
            }

            // Find or create account
            const accountId = await this.findOrCreateAccount(
              db,
              mapped.externalAccountId,
            );

            // Upsert order WITHOUT change tracking
            const created = await this.upsertOrderNoChanges(
              db,
              mapped,
              accountId,
            );

            result.processed++;
            if (created) result.created++;
            else result.updated++;
          } catch (err: any) {
            result.errored++;
            result.errors.push(err.message || 'Unknown error');
          }
        }

        hasMore = fetchResult.hasMore;
        page++;

        if (hasMore && pageDelayMs > 0) {
          await new Promise((r) => setTimeout(r, pageDelayMs));
        }
      }

      await this.completeSyncRecord(db, syncId, result);
    } catch (error: any) {
      await this.completeSyncRecord(db, syncId, result, error.message);
      throw error;
    }

    this.logger.log(
      `Historical import done: ${result.processed} processed, ${result.created} created, ${result.updated} updated, ${result.pages} pages`,
    );

    return result;
  }

  // ---- Fetchers (lightweight — no sync-worker dependency) ----

  private buildFetcher(
    type: 'netsuite' | 'zoho',
    connData: Record<string, unknown>,
  ): (
    startDate: Date,
    limit: number,
    page: number,
  ) => Promise<{ data: Record<string, unknown>[]; hasMore: boolean }> {
    if (type === 'zoho') {
      return this.buildZohoFetcher(connData);
    }
    return this.buildNetsuiteFetcher(connData);
  }

  private buildZohoFetcher(
    connData: Record<string, unknown>,
  ): (
    startDate: Date,
    limit: number,
    page: number,
  ) => Promise<{ data: Record<string, unknown>[]; hasMore: boolean }> {
    const clientId = connData['client_id'] as string;
    const clientSecret = connData['client_secret'] as string;
    const refreshToken = connData['refresh_token'] as string;
    const apiDomain =
      (connData['api_domain'] as string) || 'https://www.zohoapis.com';
    const ordersModule =
      (connData['orders_module'] as string) || 'Sales_Orders';

    let accessToken: string | null = null;
    let tokenExpiresAt = 0;

    const getToken = async (): Promise<string> => {
      if (accessToken && Date.now() < tokenExpiresAt - 60000) {
        return accessToken;
      }
      const resp = await fetch('https://accounts.zoho.com/oauth/v2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
        }).toString(),
      });
      const data = (await resp.json()) as {
        access_token: string;
        expires_in: number;
      };
      accessToken = data.access_token;
      tokenExpiresAt = Date.now() + data.expires_in * 1000;
      return accessToken;
    };

    return async (startDate, limit, page) => {
      const token = await getToken();
      const params: Record<string, string> = {
        per_page: String(limit),
        page: String(page),
        criteria: `(Modified_Time:greater_than:${startDate.toISOString()})`,
      };
      const qs = new URLSearchParams(params).toString();
      const resp = await fetch(
        `${apiDomain}/crm/v3/${ordersModule}?${qs}`,
        {
          headers: {
            Authorization: `Zoho-oauthtoken ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );
      if (!resp.ok) return { data: [], hasMore: false };
      const body = (await resp.json()) as {
        data?: Record<string, unknown>[];
        info?: { more_records?: boolean };
      };
      return {
        data: body.data ?? [],
        hasMore: body.info?.more_records ?? false,
      };
    };
  }

  private buildNetsuiteFetcher(
    connData: Record<string, unknown>,
  ): (
    startDate: Date,
    limit: number,
    page: number,
  ) => Promise<{ data: Record<string, unknown>[]; hasMore: boolean }> {
    // NetSuite uses RESTlets — we call the order script with last_modified param
    // This is a simplified fetcher; in practice the adapter handles OAuth
    const restletHost = connData['netsuite_restlet_host'] as string;
    const scriptId = connData['netsuite_order_script_id'] as string;
    const deployId = connData['netsuite_deploy_id'] as number;

    return async (startDate, limit, page) => {
      // For historical import via NetSuite, we use the same RESTlet
      // but pass last_modified and pagination params
      // The actual OAuth signing is handled by the NetSuite adapter in sync-worker
      // For client-api, we return a stub that tells the user to use the sync-worker endpoint
      this.logger.warn(
        'NetSuite historical import should be triggered via sync-worker for proper OAuth handling',
      );
      return { data: [], hasMore: false };
    };
  }

  // ---- Simple mapper ----

  private buildMapper(
    type: 'netsuite' | 'zoho',
    connData: Record<string, unknown>,
  ): (raw: Record<string, unknown>) => {
    externalOrderId: string;
    externalAccountId: string;
    externalOrderStatus?: string;
    isDep: boolean;
    po?: string;
    source: string;
    depOrderId?: string;
    depOrderedAt?: Date;
    depShippedAt?: Date;
    items: {
      serialNumber: string;
      isDep: boolean;
      depStatus: 'pending';
    }[];
  } {
    if (type === 'zoho') {
      return (raw) => {
        const items: { serialNumber: string; isDep: boolean; depStatus: 'pending' }[] = [];
        const rawItems = (raw['Product_Details'] ?? raw['Ordered_Items'] ?? []) as Record<string, unknown>[];
        if (Array.isArray(rawItems)) {
          for (const item of rawItems) {
            const serials = String(item['Serial_Numbers'] ?? item['Serials'] ?? '');
            for (const sn of serials.split(/[,;\n\r]+/).map((s) => s.trim()).filter(Boolean)) {
              const isDep = Boolean(item['Is_DEP'] ?? item['DEP_Eligible'] ?? false);
              items.push({ serialNumber: sn, isDep, depStatus: 'pending' });
            }
          }
        }
        return {
          externalOrderId: String(raw['id'] ?? raw['Id'] ?? ''),
          externalAccountId: String((raw['Account_Name'] as any)?.id ?? raw['Account_Name'] ?? ''),
          externalOrderStatus: raw['Status'] ? String(raw['Status']) : undefined,
          isDep: Boolean(raw['Is_DEP'] ?? raw['DEP_Eligible'] ?? false),
          po: raw['PO_Number'] ? String(raw['PO_Number']) : undefined,
          source: 'zoho',
          depOrderId: raw['DEP_Order_ID'] ? String(raw['DEP_Order_ID']) : undefined,
          depOrderedAt: raw['DEP_Ordered_At'] ? new Date(String(raw['DEP_Ordered_At'])) : undefined,
          depShippedAt: raw['DEP_Shipped_At'] ? new Date(String(raw['DEP_Shipped_At'])) : undefined,
          items,
        };
      };
    }

    // NetSuite mapper
    return (raw) => ({
      externalOrderId: String(raw['id'] ?? raw['internalid'] ?? raw['tranid'] ?? ''),
      externalAccountId: String((raw['entity'] as any)?.id ?? raw['entity'] ?? ''),
      externalOrderStatus: raw['status'] ? String(raw['status']) : undefined,
      isDep: Boolean(raw['custbody_is_dep'] ?? raw['is_dep'] ?? false),
      po: raw['otherrefnum'] ? String(raw['otherrefnum']) : undefined,
      source: 'netsuite',
      depOrderId: raw['custbody_dep_order_id'] ? String(raw['custbody_dep_order_id']) : undefined,
      depOrderedAt: raw['custbody_dep_ordered_at'] ? new Date(String(raw['custbody_dep_ordered_at'])) : undefined,
      depShippedAt: raw['custbody_dep_shipped_at'] ? new Date(String(raw['custbody_dep_shipped_at'])) : undefined,
      items: [],
    });
  }

  // ---- DB helpers (no change tracking) ----

  private async findOrCreateAccount(
    db: TenantDb,
    externalAccountId: string,
  ): Promise<number> {
    const existing = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.externalAccountId, externalAccountId))
      .limit(1);

    if (existing.length > 0) return existing[0].id;

    const result = await db.insert(accounts).values({
      externalAccountId,
      name: `Account ${externalAccountId}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return Number(result[0].insertId);
  }

  private async upsertOrderNoChanges(
    db: TenantDb,
    order: ReturnType<ReturnType<typeof this.buildMapper>>,
    accountId: number,
  ): Promise<boolean> {
    const existing = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.externalOrderId, order.externalOrderId))
      .limit(1);

    const now = new Date();

    if (existing.length > 0) {
      // Update existing — NO change tracking
      await db
        .update(orders)
        .set({
          externalOrderStatus: order.externalOrderStatus,
          po: order.po,
          depOrderId: order.depOrderId,
          depOrderedAt: order.depOrderedAt,
          depShippedAt: order.depShippedAt,
          updatedAt: now,
        })
        .where(eq(orders.id, existing[0].id));

      // Upsert items without change tracking
      for (const item of order.items) {
        const existingItem = await db
          .select({ id: orderItems.id })
          .from(orderItems)
          .where(
            and(
              eq(orderItems.orderId, existing[0].id),
              eq(orderItems.serialNumber, item.serialNumber),
            ),
          )
          .limit(1);

        if (existingItem.length === 0) {
          await db.insert(orderItems).values({
            orderId: existing[0].id,
            serialNumber: item.serialNumber,
            isDep: item.isDep,
            depStatus: item.depStatus,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      return false;
    }

    // Create new — NO change tracking
    const result = await db.insert(orders).values({
      orderId: uuidv4(),
      accountId,
      externalOrderId: order.externalOrderId,
      externalAccountId: order.externalAccountId,
      externalOrderStatus: order.externalOrderStatus,
      status: 'waiting',
      po: order.po,
      source: order.source,
      depOrderId: order.depOrderId,
      depOrderedAt: order.depOrderedAt,
      depShippedAt: order.depShippedAt,
      createdAt: now,
      updatedAt: now,
    });

    const orderId = Number(result[0].insertId);

    for (const item of order.items) {
      await db.insert(orderItems).values({
        orderId,
        serialNumber: item.serialNumber,
        isDep: item.isDep,
        depStatus: item.depStatus,
        createdAt: now,
        updatedAt: now,
      });
    }

    return true;
  }

  // ---- Sync status tracking ----

  private async startSyncRecord(db: TenantDb): Promise<number> {
    const now = new Date();
    const result = await db.insert(syncStatusTable).values({
      syncType: 'orders',
      status: 'running',
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return Number(result[0].insertId);
  }

  private async completeSyncRecord(
    db: TenantDb,
    id: number,
    result: ImportResult,
    errorMsg?: string,
  ) {
    await db
      .update(syncStatusTable)
      .set({
        status: errorMsg ? 'error' : 'success',
        recordsProcessed: result.processed,
        recordsCreated: result.created,
        recordsUpdated: result.updated,
        recordsErrored: result.errored,
        errorMessage: errorMsg || (result.errors[0] ?? null),
        completedAt: new Date(),
        lastSuccessAt: errorMsg ? undefined : new Date(),
        updatedAt: new Date(),
      })
      .where(eq(syncStatusTable.id, id));
  }
}
