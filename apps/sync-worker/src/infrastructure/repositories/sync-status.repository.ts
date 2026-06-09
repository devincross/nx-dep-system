import { Injectable, Logger } from '@nestjs/common';
import { eq, desc } from 'drizzle-orm';
import { TenantDb, syncStatus } from '@org/database';
import {
  SyncStatusRepositoryPort,
  SyncStatusEntity,
} from '../../domain/ports/repository.port.js';

@Injectable()
export class SyncStatusRepository implements SyncStatusRepositoryPort {
  private readonly logger = new Logger(SyncStatusRepository.name);
  private db: TenantDb | null = null;

  setDb(db: TenantDb): void {
    this.db = db;
  }

  private ensureDb(): TenantDb {
    if (!this.db) {
      throw new Error('Database not set. Call setDb() first.');
    }
    return this.db;
  }

  async getLatest(syncType: 'accounts' | 'orders' | 'full'): Promise<SyncStatusEntity | null> {
    const db = this.ensureDb();
    
    const results = await db
      .select()
      .from(syncStatus)
      .where(eq(syncStatus.syncType, syncType))
      .orderBy(desc(syncStatus.createdAt))
      .limit(1);

    if (results.length === 0) {
      return null;
    }

    return this.toEntity(results[0]);
  }

  async create(status: Omit<SyncStatusEntity, 'id'>): Promise<SyncStatusEntity> {
    const db = this.ensureDb();
    const now = new Date();

    const result = await db.insert(syncStatus).values({
      syncType: status.syncType,
      status: status.status,
      lastSyncAt: status.lastSyncAt,
      lastSuccessAt: status.lastSuccessAt,
      recordsProcessed: status.recordsProcessed,
      recordsCreated: status.recordsCreated,
      recordsUpdated: status.recordsUpdated,
      recordsErrored: status.recordsErrored,
      errorMessage: status.errorMessage,
      errorDetails: status.errorDetails,
      startedAt: status.startedAt,
      completedAt: status.completedAt,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id: Number(result[0].insertId),
      ...status,
    };
  }

  async update(id: number, status: Partial<SyncStatusEntity>): Promise<SyncStatusEntity> {
    const db = this.ensureDb();
    const now = new Date();

    const updateData: Record<string, unknown> = { updatedAt: now };
    
    if (status.status !== undefined) updateData['status'] = status.status;
    if (status.lastSyncAt !== undefined) updateData['lastSyncAt'] = status.lastSyncAt;
    if (status.lastSuccessAt !== undefined) updateData['lastSuccessAt'] = status.lastSuccessAt;
    if (status.recordsProcessed !== undefined) updateData['recordsProcessed'] = status.recordsProcessed;
    if (status.recordsCreated !== undefined) updateData['recordsCreated'] = status.recordsCreated;
    if (status.recordsUpdated !== undefined) updateData['recordsUpdated'] = status.recordsUpdated;
    if (status.recordsErrored !== undefined) updateData['recordsErrored'] = status.recordsErrored;
    if (status.errorMessage !== undefined) updateData['errorMessage'] = status.errorMessage;
    if (status.errorDetails !== undefined) updateData['errorDetails'] = status.errorDetails;
    if (status.completedAt !== undefined) updateData['completedAt'] = status.completedAt;

    await db.update(syncStatus).set(updateData).where(eq(syncStatus.id, id));

    const updated = await db.select().from(syncStatus).where(eq(syncStatus.id, id)).limit(1);
    return this.toEntity(updated[0]);
  }

  async startSync(syncType: 'accounts' | 'orders' | 'full'): Promise<SyncStatusEntity> {
    const now = new Date();
    
    return this.create({
      syncType,
      status: 'running',
      lastSyncAt: now,
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsErrored: 0,
      startedAt: now,
    });
  }

  async completeSync(
    id: number,
    results: {
      recordsProcessed: number;
      recordsCreated: number;
      recordsUpdated: number;
      recordsErrored: number;
      errorMessage?: string;
      errorDetails?: string;
    }
  ): Promise<SyncStatusEntity> {
    const now = new Date();
    const hasErrors = results.recordsErrored > 0 || !!results.errorMessage;

    return this.update(id, {
      status: hasErrors ? 'error' : 'success',
      lastSuccessAt: hasErrors ? undefined : now,
      recordsProcessed: results.recordsProcessed,
      recordsCreated: results.recordsCreated,
      recordsUpdated: results.recordsUpdated,
      recordsErrored: results.recordsErrored,
      errorMessage: results.errorMessage,
      errorDetails: results.errorDetails,
      completedAt: now,
    });
  }

  private toEntity(row: typeof syncStatus.$inferSelect): SyncStatusEntity {
    return {
      id: row.id,
      syncType: row.syncType,
      status: row.status,
      lastSyncAt: row.lastSyncAt ?? undefined,
      lastSuccessAt: row.lastSuccessAt ?? undefined,
      recordsProcessed: row.recordsProcessed ?? 0,
      recordsCreated: row.recordsCreated ?? 0,
      recordsUpdated: row.recordsUpdated ?? 0,
      recordsErrored: row.recordsErrored ?? 0,
      errorMessage: row.errorMessage ?? undefined,
      errorDetails: row.errorDetails ?? undefined,
      startedAt: row.startedAt ?? undefined,
      completedAt: row.completedAt ?? undefined,
    };
  }
}

