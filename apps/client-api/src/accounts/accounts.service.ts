import { Injectable, Logger } from '@nestjs/common';
import { eq, like, or, desc, type SQL } from 'drizzle-orm';
import { TenantDb, accounts } from '@org/database';
import { NetsuiteService } from '../netsuite/netsuite.service.js';
import { ZohoService } from '../zoho/zoho.service.js';
import type { TenantContext } from '../tenant/tenant-context.service.js';

export interface SyncAllResult {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
}

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    private readonly netsuiteService: NetsuiteService,
    private readonly zohoService: ZohoService,
  ) {}

  /**
   * List accounts with optional case-insensitive search across
   * name / external id / DEP account id.
   */
  async findAll(db: TenantDb, search?: string) {
    const trimmed = search?.trim();
    if (!trimmed) {
      return db.select().from(accounts).orderBy(desc(accounts.id));
    }
    const pattern = `%${trimmed}%`;
    const filter = or(
      like(accounts.name, pattern),
      like(accounts.externalAccountId, pattern),
      like(accounts.depAccountId, pattern),
    ) as SQL<unknown>;
    return db.select().from(accounts).where(filter).orderBy(desc(accounts.id));
  }

  /**
   * Pull every account from the tenant's configured ERP and upsert by
   * externalAccountId. Routes to Zoho or NetSuite based on the tenant's
   * connectionType (default netsuite).
   */
  async syncAll(tenant: TenantContext): Promise<SyncAllResult> {
    const metadata = tenant.tenant.metadata ? JSON.parse(tenant.tenant.metadata) : {};
    const connectionType: 'netsuite' | 'zoho' = metadata.connectionType || 'netsuite';
    return connectionType === 'zoho'
      ? this.syncAllZoho(tenant.db)
      : this.syncAllNetsuite(tenant.db);
  }

  private async syncAllZoho(db: TenantDb): Promise<SyncAllResult> {
    const result: SyncAllResult = { fetched: 0, created: 0, updated: 0, skipped: 0 };

    const list = await this.zohoService.getMappedAccounts(db);
    result.fetched = list.length;
    this.logger.log(`syncAll: fetched ${list.length} accounts from Zoho`);

    for (const acct of list) {
      if (!acct.externalAccountId) {
        result.skipped++;
        continue;
      }
      await this.upsertAccount(db, acct.externalAccountId, acct.name, acct.depAccountId, result);
    }

    this.logger.log(
      `syncAll complete: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped`,
    );
    return result;
  }

  private async syncAllNetsuite(db: TenantDb): Promise<SyncAllResult> {
    const result: SyncAllResult = { fetched: 0, created: 0, updated: 0, skipped: 0 };

    const response = await this.netsuiteService.callAccountScript<unknown>(db, 'GET', {
      last_modified: '2008-01-01',
    });

    if (!response.success) {
      throw new Error(response.error || 'NetSuite account fetch failed');
    }

    const raw = response.data as unknown;
    const list: Array<Record<string, unknown>> = Array.isArray(raw)
      ? (raw as Array<Record<string, unknown>>)
      : (((raw as Record<string, unknown>)?.['data'] as Array<Record<string, unknown>>) ?? []);

    result.fetched = list.length;
    this.logger.log(`syncAll: fetched ${list.length} accounts from NetSuite`);

    for (const row of list) {
      const externalAccountId = this.str(row['account_id']);
      if (!externalAccountId) {
        result.skipped++;
        continue;
      }
      await this.upsertAccount(
        db,
        externalAccountId,
        this.str(row['name']),
        this.str(row['dep_id']),
        result,
      );
    }

    this.logger.log(
      `syncAll complete: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped`,
    );
    return result;
  }

  /**
   * Upsert one account by externalAccountId. accounts has no unique key on
   * external_account_id, so onDuplicateKeyUpdate can't fire — update existing
   * rows directly (all, in case duplicates exist), then insert if none matched.
   */
  private async upsertAccount(
    db: TenantDb,
    externalAccountId: string,
    name: string | undefined,
    depAccountId: string | undefined,
    result: SyncAllResult,
  ): Promise<void> {
    const now = new Date();
    const updateResult = await db
      .update(accounts)
      .set({
        ...(name ? { name } : {}),
        ...(depAccountId ? { depAccountId } : {}),
        updatedAt: now,
      })
      .where(eq(accounts.externalAccountId, externalAccountId));

    const affected =
      (updateResult as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0;
    if (affected > 0) {
      result.updated++;
    } else {
      await db
        .insert(accounts)
        .values({ externalAccountId, name, depAccountId, createdAt: now, updatedAt: now });
      result.created++;
    }
  }

  private str(v: unknown): string | undefined {
    if (typeof v === 'string') {
      const trimmed = v.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
    if (typeof v === 'number') return String(v);
    return undefined;
  }
}
