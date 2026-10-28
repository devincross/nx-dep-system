import { Injectable, Logger } from "@nestjs/common";
import { eq, isNull, inArray } from 'drizzle-orm';
import { TenantDb, orderChanges, orderItemChanges } from '@org/database';
import {
  OrderChangeRepositoryPort,
} from '../../domain/ports/repository.port.js';
import {
  OrderChangeEntity,
  OrderItemChangeEntity,
  UnsyncedChanges,
} from '../../domain/entities/index.js';

@Injectable()
export class OrderChangeRepository implements OrderChangeRepositoryPort {
  private readonly logger = new Logger(OrderChangeRepository.name);
  private db: TenantDb | null = null;

  /**
   * Parse a stored JSON column without letting one malformed row abort the whole
   * push. changed_fields / snapshot are written as JSON, but a bad manual insert
   * can leave a non-JSON value there; a throwing JSON.parse in findUnsyncedChanges
   * (which runs before the per-order try/catch) would stall the entire tenant.
   * On failure we log and drop the field so the change is still processed by type.
   */
  private safeParse(value: string | null, field: string, rowId: number): unknown {
    if (!value) return undefined;
    try {
      return JSON.parse(value);
    } catch {
      this.logger.warn(
        `order_changes row ${rowId}: ignoring non-JSON ${field} (${JSON.stringify(value).slice(0, 60)})`,
      );
      return undefined;
    }
  }

  setDb(db: TenantDb): void {
    this.db = db;
  }

  private ensureDb(): TenantDb {
    if (!this.db) {
      throw new Error('Database not set. Call setDb() first.');
    }
    return this.db;
  }

  async recordOrderChange(
    change: Omit<OrderChangeEntity, 'id' | 'createdAt'>
  ): Promise<OrderChangeEntity> {
    const db = this.ensureDb();
    const now = new Date();

    const result = await db.insert(orderChanges).values({
      orderId: change.orderId,
      changeType: change.changeType,
      changedFields: change.changedFields ? JSON.stringify(change.changedFields) : null,
      snapshot: change.snapshot ? JSON.stringify(change.snapshot) : null,
      syncedAt: change.syncedAt ?? null,
      createdAt: now,
    });

    return {
      id: Number(result[0].insertId),
      ...change,
      createdAt: now,
    };
  }

  async recordItemChange(
    change: Omit<OrderItemChangeEntity, 'id' | 'createdAt'>
  ): Promise<OrderItemChangeEntity> {
    const db = this.ensureDb();
    const now = new Date();

    const result = await db.insert(orderItemChanges).values({
      orderId: change.orderId,
      orderItemId: change.orderItemId ?? null,
      serialNumber: change.serialNumber,
      changeType: change.changeType,
      changedFields: change.changedFields ? JSON.stringify(change.changedFields) : null,
      snapshot: change.snapshot ? JSON.stringify(change.snapshot) : null,
      syncedAt: change.syncedAt ?? null,
      createdAt: now,
    });

    return {
      id: Number(result[0].insertId),
      ...change,
      createdAt: now,
    };
  }

  async recordItemChanges(
    changes: Omit<OrderItemChangeEntity, 'id' | 'createdAt'>[]
  ): Promise<OrderItemChangeEntity[]> {
    if (changes.length === 0) return [];
    
    const results: OrderItemChangeEntity[] = [];
    for (const change of changes) {
      const recorded = await this.recordItemChange(change);
      results.push(recorded);
    }
    return results;
  }

  async findUnsyncedChanges(): Promise<UnsyncedChanges> {
    const db = this.ensureDb();

    const orderChangeRows = await db
      .select()
      .from(orderChanges)
      .where(isNull(orderChanges.syncedAt));

    const itemChangeRows = await db
      .select()
      .from(orderItemChanges)
      .where(isNull(orderItemChanges.syncedAt));

    return {
      orderChanges: orderChangeRows.map((r) => this.toOrderChangeEntity(r)),
      itemChanges: itemChangeRows.map((r) => this.toItemChangeEntity(r)),
    };
  }

  async findUnsyncedChangesByOrderId(orderId: number): Promise<UnsyncedChanges> {
    const db = this.ensureDb();

    const orderChangeRows = await db
      .select()
      .from(orderChanges)
      .where(eq(orderChanges.orderId, orderId));

    const itemChangeRows = await db
      .select()
      .from(orderItemChanges)
      .where(eq(orderItemChanges.orderId, orderId));

    return {
      orderChanges: orderChangeRows.filter((r: { syncedAt: unknown }) => !r.syncedAt).map((r) => this.toOrderChangeEntity(r)),
      itemChanges: itemChangeRows.filter((r: { syncedAt: unknown }) => !r.syncedAt).map((r) => this.toItemChangeEntity(r)),
    };
  }

  async markOrderChangesSynced(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const db = this.ensureDb();
    await db.update(orderChanges)
      .set({ syncedAt: new Date() })
      .where(inArray(orderChanges.id, ids));
  }

  async markItemChangesSynced(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const db = this.ensureDb();
    await db.update(orderItemChanges)
      .set({ syncedAt: new Date() })
      .where(inArray(orderItemChanges.id, ids));
  }

  async markOrderFullySynced(orderId: number): Promise<void> {
    const db = this.ensureDb();
    const now = new Date();

    await db.update(orderChanges)
      .set({ syncedAt: now })
      .where(eq(orderChanges.orderId, orderId));

    await db.update(orderItemChanges)
      .set({ syncedAt: now })
      .where(eq(orderItemChanges.orderId, orderId));
  }

  private toOrderChangeEntity(row: typeof orderChanges.$inferSelect): OrderChangeEntity {
    return {
      id: row.id,
      orderId: row.orderId,
      changeType: row.changeType,
      changedFields: this.safeParse(row.changedFields, 'changedFields', row.id) as OrderChangeEntity['changedFields'],
      snapshot: this.safeParse(row.snapshot, 'snapshot', row.id) as OrderChangeEntity['snapshot'],
      syncedAt: row.syncedAt ?? undefined,
      createdAt: row.createdAt ?? undefined,
    };
  }

  private toItemChangeEntity(row: typeof orderItemChanges.$inferSelect): OrderItemChangeEntity {
    return {
      id: row.id,
      orderId: row.orderId,
      orderItemId: row.orderItemId ?? undefined,
      serialNumber: row.serialNumber,
      changeType: row.changeType,
      changedFields: this.safeParse(row.changedFields, 'changedFields', row.id) as OrderItemChangeEntity['changedFields'],
      snapshot: this.safeParse(row.snapshot, 'snapshot', row.id) as OrderItemChangeEntity['snapshot'],
      syncedAt: row.syncedAt ?? undefined,
      createdAt: row.createdAt ?? undefined,
    };
  }
}

