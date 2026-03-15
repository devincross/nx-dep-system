import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { TenantDb, orders, orderItems } from '@org/database';
import {
  OrderRepositoryPort,
  OrderChangeRepositoryPort,
  PersistedOrderEntity,
} from '../../domain/ports/repository.port.js';
import {
  OrderEntity,
  PersistedOrderItemEntity,
  OrderItemEntity,
  ChangedFields,
  OrderItemChangeEntity,
} from '../../domain/entities/index.js';

@Injectable()
export class OrderRepository implements OrderRepositoryPort {
  private readonly logger = new Logger(OrderRepository.name);
  private db: TenantDb | null = null;
  private changeRepository: OrderChangeRepositoryPort | null = null;

  setDb(db: TenantDb): void {
    this.db = db;
  }

  setChangeRepository(changeRepository: OrderChangeRepositoryPort): void {
    this.changeRepository = changeRepository;
  }

  private ensureDb(): TenantDb {
    if (!this.db) {
      throw new Error('Database not set. Call setDb() first.');
    }
    return this.db;
  }

  async findById(id: number): Promise<PersistedOrderEntity | null> {
    const db = this.ensureDb();

    const results = await db
      .select()
      .from(orders)
      .where(eq(orders.id, id))
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
      // Detect and record changes before updating
      await this.detectAndRecordChanges(existing, order);

      // Sync items (add new, remove missing, update existing)
      await this.syncOrderItems(existing.id, existing.items, order.items);

      const updated = await this.update(existing.id, order);
      return { entity: updated, created: false };
    } else {
      const created = await this.create(order, accountId);

      // Record order creation
      await this.recordOrderCreated(created);

      return { entity: created, created: true };
    }
  }

  /**
   * Detect changes between existing and incoming order data and record them
   */
  private async detectAndRecordChanges(
    existing: PersistedOrderEntity,
    incoming: OrderEntity
  ): Promise<void> {
    if (!this.changeRepository) {
      this.logger.debug('Change repository not set, skipping change tracking');
      return;
    }

    const changedFields: ChangedFields = {};

    // Check order-level field changes
    if (existing.externalOrderStatus !== incoming.externalOrderStatus) {
      changedFields['externalOrderStatus'] = {
        old: existing.externalOrderStatus,
        new: incoming.externalOrderStatus,
      };
    }
    if (existing.po !== incoming.po) {
      changedFields['po'] = { old: existing.po, new: incoming.po };
    }

    // Only record order change if there are field changes
    if (Object.keys(changedFields).length > 0) {
      await this.changeRepository.recordOrderChange({
        orderId: existing.id,
        changeType: 'updated',
        changedFields,
        snapshot: this.createOrderSnapshot(existing),
      });
    }
  }

  /**
   * Sync order items - detect added, updated, and removed items
   */
  private async syncOrderItems(
    orderId: number,
    existingItems: PersistedOrderItemEntity[],
    incomingItems: OrderItemEntity[]
  ): Promise<void> {
    const db = this.ensureDb();
    const now = new Date();

    // Create maps for efficient lookup
    const existingBySerial = new Map(
      existingItems.map(item => [item.serialNumber, item])
    );
    const incomingBySerial = new Map(
      incomingItems.map(item => [item.serialNumber, item])
    );

    const itemChanges: Omit<OrderItemChangeEntity, 'id' | 'createdAt'>[] = [];

    // Detect added and updated items
    for (const incoming of incomingItems) {
      const existing = existingBySerial.get(incoming.serialNumber);

      if (!existing) {
        // New item - insert it
        const result = await db.insert(orderItems).values({
          orderId,
          serialNumber: incoming.serialNumber,
          isDep: incoming.isDep,
          depStatus: incoming.depStatus,
          createdAt: now,
          updatedAt: now,
        });

        itemChanges.push({
          orderId,
          orderItemId: Number(result[0].insertId),
          serialNumber: incoming.serialNumber,
          changeType: 'added',
          snapshot: { ...incoming },
        });
      } else {
        // Existing item - check for updates
        const fieldChanges: ChangedFields = {};

        if (existing.isDep !== incoming.isDep) {
          fieldChanges['isDep'] = { old: existing.isDep, new: incoming.isDep };
        }
        if (existing.depStatus !== incoming.depStatus) {
          fieldChanges['depStatus'] = { old: existing.depStatus, new: incoming.depStatus };
        }

        if (Object.keys(fieldChanges).length > 0) {
          // Update the item
          await db.update(orderItems)
            .set({
              isDep: incoming.isDep,
              depStatus: incoming.depStatus,
              updatedAt: now,
            })
            .where(eq(orderItems.id, existing.id));

          itemChanges.push({
            orderId,
            orderItemId: existing.id,
            serialNumber: incoming.serialNumber,
            changeType: 'updated',
            changedFields: fieldChanges,
            snapshot: { ...incoming },
          });
        }
      }
    }

    // Detect removed items (in existing but not in incoming)
    for (const existing of existingItems) {
      if (!incomingBySerial.has(existing.serialNumber)) {
        // Item was removed - soft delete by setting deletedAt
        await db.update(orderItems)
          .set({ deletedAt: now, updatedAt: now })
          .where(eq(orderItems.id, existing.id));

        itemChanges.push({
          orderId,
          orderItemId: existing.id,
          serialNumber: existing.serialNumber,
          changeType: 'removed',
          snapshot: {
            id: existing.id,
            serialNumber: existing.serialNumber,
            isDep: existing.isDep,
            depStatus: existing.depStatus,
          },
        });
      }
    }

    // Record all item changes
    if (this.changeRepository && itemChanges.length > 0) {
      await this.changeRepository.recordItemChanges(itemChanges);
    }
  }

  /**
   * Record that a new order was created
   */
  private async recordOrderCreated(order: PersistedOrderEntity): Promise<void> {
    if (!this.changeRepository) return;

    // Record order creation
    await this.changeRepository.recordOrderChange({
      orderId: order.id,
      changeType: 'created',
      snapshot: this.createOrderSnapshot(order),
    });

    // Record all items as added
    const itemChanges = order.items.map(item => ({
      orderId: order.id,
      orderItemId: item.id,
      serialNumber: item.serialNumber,
      changeType: 'added' as const,
      snapshot: {
        serialNumber: item.serialNumber,
        isDep: item.isDep,
        depStatus: item.depStatus,
      },
    }));

    if (itemChanges.length > 0) {
      await this.changeRepository.recordItemChanges(itemChanges);
    }
  }

  /**
   * Create a snapshot of the order for change tracking
   */
  private createOrderSnapshot(order: PersistedOrderEntity): Record<string, unknown> {
    return {
      id: order.id,
      orderId: order.orderId,
      externalOrderId: order.externalOrderId,
      externalAccountId: order.externalAccountId,
      externalOrderStatus: order.externalOrderStatus,
      status: order.status,
      po: order.po,
      source: order.source,
    };
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

