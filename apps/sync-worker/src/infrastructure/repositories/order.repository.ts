import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { TenantDb, orders, orderItems } from '@org/database';
import {
  OrderRepositoryPort,
  PersistedOrderEntity,
} from '../../domain/ports/repository.port.js';
import { OrderEntity, PersistedOrderItemEntity } from '../../domain/entities/order.entity.js';

@Injectable()
export class OrderRepository implements OrderRepositoryPort {
  private readonly logger = new Logger(OrderRepository.name);
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

  async findByExternalId(externalOrderId: string): Promise<PersistedOrderEntity | null> {
    const db = this.ensureDb();
    
    const results = await db
      .select()
      .from(orders)
      .where(eq(orders.externalOrderId, externalOrderId))
      .limit(1);

    if (results.length === 0) {
      return null;
    }

    const order = results[0];
    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));

    return this.toEntity(order, items);
  }

  async create(order: OrderEntity, accountId: number): Promise<PersistedOrderEntity> {
    const db = this.ensureDb();
    const now = new Date();
    const orderId = uuidv4();

    const result = await db.insert(orders).values({
      orderId,
      accountId,
      externalOrderId: order.externalOrderId,
      externalAccountId: order.externalAccountId,
      externalOrderStatus: order.externalOrderStatus,
      status: 'waiting',
      po: order.po,
      source: order.source,
      createdAt: now,
      updatedAt: now,
    });

    const insertId = Number(result[0].insertId);

    // Insert order items
    const createdItems: PersistedOrderItemEntity[] = [];
    for (const item of order.items) {
      const itemResult = await db.insert(orderItems).values({
        orderId: insertId,
        serialNumber: item.serialNumber,
        isDep: item.isDep,
        depStatus: item.depStatus,
        createdAt: now,
        updatedAt: now,
      });

      createdItems.push({
        id: Number(itemResult[0].insertId),
        orderId: insertId,
        serialNumber: item.serialNumber,
        isDep: item.isDep,
        depStatus: item.depStatus,
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      id: insertId,
      orderId,
      accountId,
      externalOrderId: order.externalOrderId,
      externalAccountId: order.externalAccountId,
      externalOrderStatus: order.externalOrderStatus,
      isDep: order.isDep,
      po: order.po,
      source: order.source,
      status: 'waiting',
      createdAt: now,
      updatedAt: now,
      items: createdItems,
    };
  }

  async update(id: number, order: Partial<OrderEntity>): Promise<PersistedOrderEntity> {
    const db = this.ensureDb();
    const now = new Date();

    const updateData: Record<string, unknown> = { updatedAt: now };
    
    if (order.externalOrderStatus !== undefined) {
      updateData['externalOrderStatus'] = order.externalOrderStatus;
    }
    if (order.po !== undefined) {
      updateData['po'] = order.po;
    }

    await db.update(orders).set(updateData).where(eq(orders.id, id));

    return this.findByExternalId(order.externalOrderId ?? '') as Promise<PersistedOrderEntity>;
  }

  async upsert(order: OrderEntity, accountId: number): Promise<{ entity: PersistedOrderEntity; created: boolean }> {
    const existing = await this.findByExternalId(order.externalOrderId);

    if (existing) {
      const updated = await this.update(existing.id, order);
      return { entity: updated, created: false };
    } else {
      const created = await this.create(order, accountId);
      return { entity: created, created: true };
    }
  }

  private toEntity(
    row: typeof orders.$inferSelect,
    items: (typeof orderItems.$inferSelect)[]
  ): PersistedOrderEntity {
    return {
      id: row.id,
      orderId: row.orderId,
      accountId: row.accountId,
      externalOrderId: row.externalOrderId ?? '',
      externalAccountId: row.externalAccountId ?? '',
      externalOrderStatus: row.externalOrderStatus ?? undefined,
      isDep: false, // Determined from items
      po: row.po ?? undefined,
      source: row.source ?? undefined,
      status: row.status,
      depOrderId: row.depOrderId ?? undefined,
      depOrderedAt: row.depOrderedAt ?? undefined,
      depShippedAt: row.depShippedAt ?? undefined,
      createdAt: row.createdAt ?? new Date(),
      updatedAt: row.updatedAt ?? new Date(),
      items: items.map(item => ({
        id: item.id,
        orderId: item.orderId,
        serialNumber: item.serialNumber,
        isDep: item.isDep,
        depStatus: item.depStatus,
        createdAt: item.createdAt ?? new Date(),
        updatedAt: item.updatedAt ?? new Date(),
      })),
    };
  }
}

