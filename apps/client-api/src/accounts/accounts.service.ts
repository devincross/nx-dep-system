import { Injectable, Logger } from '@nestjs/common';
import { like, or, desc, sql, type SQL } from 'drizzle-orm';
import { TenantDb, accounts } from '@org/database';
import { NetsuiteService } from '../netsuite/netsuite.service.js';

export interface SyncAllResult {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
}

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(private readonly netsuiteService: NetsuiteService) {}

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
   * Pull every account NetSuite has by passing a far-past last_modified
   * and upserting by externalAccountId.
   */
  async syncAll(db: TenantDb): Promise<SyncAllResult> {
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
      const externalAccountId = this.pickString(row, ['id', 'internalid', 'entityid', 'External_Account_ID']);
      if (!externalAccountId) {
        result.skipped++;
        continue;
      }

      const name = this.pickString(row, ['companyname', 'entityid', 'name']);
      const depAccountId = this.pickString(row, [
        'dep_id',
        'custentity_dep_account_id',
        'custentity_apple_dep_id',
        'depAccountId',
        'DEP_Account_ID',
      ]);

      const now = new Date();
      const insertResult = await db
        .insert(accounts)
        .values({ externalAccountId, name, depAccountId, createdAt: now, updatedAt: now })
        .onDuplicateKeyUpdate({
          set: {
            name: sql`COALESCE(VALUES(name), ${accounts.name})`,
            depAccountId: sql`COALESCE(VALUES(dep_account_id), ${accounts.depAccountId})`,
            updatedAt: now,
          },
        });

      // MySQL2 returns affectedRows: 1 for insert, 2 for update on duplicate-key
      const affected = (insertResult as unknown as { affectedRows?: number })?.affectedRows ?? 0;
      if (affected >= 2) result.updated++;
      else if (affected === 1) result.created++;
      else result.skipped++;
    }

    this.logger.log(
      `syncAll complete: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped`,
    );
    return result;
  }

  private pickString(row: Record<string, unknown>, keys: string[]): string | undefined {
    for (const k of keys) {
      const v = row[k];
      if (typeof v === 'string' && v.trim().length > 0) return v.trim();
      if (typeof v === 'number') return String(v);
    }
    return undefined;
  }
}
