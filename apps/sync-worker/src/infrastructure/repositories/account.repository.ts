import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { TenantDb, accounts } from '@org/database';
import {
  AccountRepositoryPort,
  PersistedAccountEntity,
} from '../../domain/ports/repository.port.js';
import { AccountEntity } from '../../domain/entities/account.entity.js';

@Injectable()
export class AccountRepository implements AccountRepositoryPort {
  private readonly logger = new Logger(AccountRepository.name);
  private db: TenantDb | null = null;

  /**
   * Set the database connection for this repository
   */
  setDb(db: TenantDb): void {
    this.db = db;
  }

  private ensureDb(): TenantDb {
    if (!this.db) {
      throw new Error('Database not set. Call setDb() first.');
    }
    return this.db;
  }

  async findByExternalId(externalAccountId: string): Promise<PersistedAccountEntity | null> {
    const db = this.ensureDb();
    
    const results = await db
      .select()
      .from(accounts)
      .where(eq(accounts.externalAccountId, externalAccountId))
      .limit(1);

    if (results.length === 0) {
      return null;
    }

    return this.toEntity(results[0]);
  }

  async create(account: AccountEntity): Promise<PersistedAccountEntity> {
    const db = this.ensureDb();
    const now = new Date();

    const result = await db.insert(accounts).values({
      externalAccountId: account.externalAccountId,
      depAccountId: account.depAccountId,
      name: account.name,
      createdAt: now,
      updatedAt: now,
    });

    const insertId = Number(result[0].insertId);
    
    return {
      id: insertId,
      ...account,
      createdAt: now,
      updatedAt: now,
    };
  }

  async update(id: number, account: Partial<AccountEntity>): Promise<PersistedAccountEntity> {
    const db = this.ensureDb();
    const now = new Date();

    const updateData: Record<string, unknown> = { updatedAt: now };
    
    if (account.externalAccountId !== undefined) {
      updateData['externalAccountId'] = account.externalAccountId;
    }
    if (account.name !== undefined) {
      updateData['name'] = account.name;
    }
    if (account.depAccountId !== undefined) {
      updateData['depAccountId'] = account.depAccountId;
    }

    await db
      .update(accounts)
      .set(updateData)
      .where(eq(accounts.id, id));

    const updated = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, id))
      .limit(1);

    return this.toEntity(updated[0]);
  }

  async upsert(account: AccountEntity): Promise<{ entity: PersistedAccountEntity; created: boolean }> {
    const existing = await this.findByExternalId(account.externalAccountId);

    if (existing) {
      const updated = await this.update(existing.id, account);
      return { entity: updated, created: false };
    } else {
      const created = await this.create(account);
      return { entity: created, created: true };
    }
  }

  private toEntity(row: typeof accounts.$inferSelect): PersistedAccountEntity {
    return {
      id: row.id,
      externalAccountId: row.externalAccountId ?? '',
      name: row.name ?? '',
      depAccountId: row.depAccountId ?? undefined,
      createdAt: row.createdAt ?? new Date(),
      updatedAt: row.updatedAt ?? new Date(),
    };
  }
}

