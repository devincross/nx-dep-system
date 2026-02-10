import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { eq, isNull, and, inArray } from 'drizzle-orm';
import { TenantDb, orders, orderItems, Order, OrderItem } from '@org/database';
import { CreateOrderDto, UpdateOrderDto, CreateOrderItemDto } from './dto/index.js';

// Order with items
export interface OrderWithItems extends Order {
  items: OrderItem[];
}

@Injectable()
export class OrdersService {
  /**
   * Check if serial numbers already exist in non-deleted order items
   * @throws ConflictException if any serial number already exists
   */
  private async validateSerialNumbersUnique(
    db: TenantDb,
    serialNumbers: string[]
  ): Promise<void> {
    if (serialNumbers.length === 0) return;

    const existing = await db
      .select({ serialNumber: orderItems.serialNumber })
      .from(orderItems)
      .where(
        and(
          inArray(orderItems.serialNumber, serialNumbers),
          isNull(orderItems.deletedAt)
        )
      );

    if (existing.length > 0) {
      const duplicates = existing.map((e) => e.serialNumber).join(', ');
      throw new ConflictException(
        `Serial number(s) already exist: ${duplicates}`
      );
    }
  }

  /**
   * Find all orders (excluding soft-deleted items)
   */
  async findAll(db: TenantDb): Promise<OrderWithItems[]> {
    const orderResults = await db.select().from(orders);

    const ordersWithItems: OrderWithItems[] = [];
    for (const order of orderResults) {
      const items = await db
        .select()
        .from(orderItems)
        .where(and(eq(orderItems.orderId, order.id), isNull(orderItems.deletedAt)));

      ordersWithItems.push({ ...order, items });
    }

    return ordersWithItems;
  }

  /**
   * Find a single order by ID with its items
   */
  async findOne(db: TenantDb, id: number): Promise<OrderWithItems> {
    const result = await db.select().from(orders).where(eq(orders.id, id));

    if (result.length === 0) {
      throw new NotFoundException(`Order with ID "${id}" not found`);
    }

    const items = await db
      .select()
      .from(orderItems)
      .where(and(eq(orderItems.orderId, id), isNull(orderItems.deletedAt)));

    return { ...result[0], items };
  }

  /**
   * Find orders by account ID
   */
  async findByAccountId(db: TenantDb, accountId: number): Promise<OrderWithItems[]> {
    const orderResults = await db
      .select()
      .from(orders)
      .where(eq(orders.accountId, accountId));

    const ordersWithItems: OrderWithItems[] = [];
    for (const order of orderResults) {
      const items = await db
        .select()
        .from(orderItems)
        .where(and(eq(orderItems.orderId, order.id), isNull(orderItems.deletedAt)));

      ordersWithItems.push({ ...order, items });
    }

    return ordersWithItems;
  }

  /**
   * Create a new order with optional items
   */
  async create(db: TenantDb, createOrderDto: CreateOrderDto): Promise<OrderWithItems> {
    const now = new Date();

    const result = await db.insert(orders).values({
      orderId: createOrderDto.orderId,
      accountId: createOrderDto.accountId,
      externalOrderId: createOrderDto.externalOrderId,
      externalAccountId: createOrderDto.externalAccountId,
      externalOrderStatus: createOrderDto.externalOrderStatus,
      status: createOrderDto.status,
      po: createOrderDto.po,
      changes: createOrderDto.changes,
      depOrderId: createOrderDto.depOrderId,
      source: createOrderDto.source,
      createdAt: now,
      updatedAt: now,
    });

    const insertId = Number(result[0].insertId);

    // Insert order items if provided
    if (createOrderDto.items && createOrderDto.items.length > 0) {
      await this.createOrderItems(db, insertId, createOrderDto.items);
    }

    return this.findOne(db, insertId);
  }

  /**
   * Create order items for an order
   * @throws ConflictException if any serial number already exists in non-deleted items
   */
  async createOrderItems(
    db: TenantDb,
    orderId: number,
    items: CreateOrderItemDto[]
  ): Promise<OrderItem[]> {
    // Validate serial numbers are unique among non-deleted items
    const serialNumbers = items.map((item) => item.serialNumber);
    await this.validateSerialNumbersUnique(db, serialNumbers);

    const now = new Date();

    for (const item of items) {
      await db.insert(orderItems).values({
        orderId,
        isDep: item.isDep ?? false,
        serialNumber: item.serialNumber,
        depStatus: item.depStatus,
        createdAt: now,
        updatedAt: now,
      });
    }

    const createdItems = await db
      .select()
      .from(orderItems)
      .where(and(eq(orderItems.orderId, orderId), isNull(orderItems.deletedAt)));

    return createdItems;
  }

  /**
   * Update an existing order
   */
  async update(
    db: TenantDb,
    id: number,
    updateOrderDto: UpdateOrderDto
  ): Promise<OrderWithItems> {
    // Ensure order exists
    await this.findOne(db, id);

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (updateOrderDto.orderId !== undefined) updateData['orderId'] = updateOrderDto.orderId;
    if (updateOrderDto.accountId !== undefined) updateData['accountId'] = updateOrderDto.accountId;
    if (updateOrderDto.externalOrderId !== undefined) updateData['externalOrderId'] = updateOrderDto.externalOrderId;
    if (updateOrderDto.externalAccountId !== undefined) updateData['externalAccountId'] = updateOrderDto.externalAccountId;
    if (updateOrderDto.externalOrderStatus !== undefined) updateData['externalOrderStatus'] = updateOrderDto.externalOrderStatus;
    if (updateOrderDto.status !== undefined) updateData['status'] = updateOrderDto.status;
    if (updateOrderDto.po !== undefined) updateData['po'] = updateOrderDto.po;
    if (updateOrderDto.changes !== undefined) updateData['changes'] = updateOrderDto.changes;
    if (updateOrderDto.depOrderId !== undefined) updateData['depOrderId'] = updateOrderDto.depOrderId;
    if (updateOrderDto.source !== undefined) updateData['source'] = updateOrderDto.source;

    await db.update(orders).set(updateData).where(eq(orders.id, id));

    return this.findOne(db, id);
  }

  /**
   * Delete an order (hard delete - also deletes items)
   */
  async remove(db: TenantDb, id: number): Promise<void> {
    // Ensure order exists
    await this.findOne(db, id);

    // Delete order items first
    await db.delete(orderItems).where(eq(orderItems.orderId, id));

    // Delete the order
    await db.delete(orders).where(eq(orders.id, id));
  }

  /**
   * Update an order item
   * @throws ConflictException if new serial number already exists in non-deleted items
   */
  async updateOrderItem(
    db: TenantDb,
    orderId: number,
    itemId: number,
    updateData: Partial<CreateOrderItemDto>
  ): Promise<OrderItem> {
    // Ensure order exists
    await this.findOne(db, orderId);

    const itemResult = await db
      .select()
      .from(orderItems)
      .where(
        and(
          eq(orderItems.id, itemId),
          eq(orderItems.orderId, orderId),
          isNull(orderItems.deletedAt)
        )
      );

    if (itemResult.length === 0) {
      throw new NotFoundException(`Order item with ID "${itemId}" not found`);
    }

    // If updating serial number, validate it's unique (excluding current item)
    if (
      updateData.serialNumber !== undefined &&
      updateData.serialNumber !== itemResult[0].serialNumber
    ) {
      const existing = await db
        .select()
        .from(orderItems)
        .where(
          and(
            eq(orderItems.serialNumber, updateData.serialNumber),
            isNull(orderItems.deletedAt)
          )
        );

      if (existing.length > 0) {
        throw new ConflictException(
          `Serial number already exists: ${updateData.serialNumber}`
        );
      }
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (updateData.isDep !== undefined) update['isDep'] = updateData.isDep;
    if (updateData.serialNumber !== undefined) update['serialNumber'] = updateData.serialNumber;
    if (updateData.depStatus !== undefined) update['depStatus'] = updateData.depStatus;

    await db.update(orderItems).set(update).where(eq(orderItems.id, itemId));

    const updated = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.id, itemId));

    return updated[0];
  }

  /**
   * Soft delete an order item
   */
  async removeOrderItem(db: TenantDb, orderId: number, itemId: number): Promise<void> {
    // Ensure order exists
    await this.findOne(db, orderId);

    const itemResult = await db
      .select()
      .from(orderItems)
      .where(
        and(
          eq(orderItems.id, itemId),
          eq(orderItems.orderId, orderId),
          isNull(orderItems.deletedAt)
        )
      );

    if (itemResult.length === 0) {
      throw new NotFoundException(`Order item with ID "${itemId}" not found`);
    }

    await db
      .update(orderItems)
      .set({ deletedAt: new Date() })
      .where(eq(orderItems.id, itemId));
  }

  /**
   * Restore a soft-deleted order item
   */
  async restoreOrderItem(db: TenantDb, orderId: number, itemId: number): Promise<OrderItem> {
    // Ensure order exists
    await this.findOne(db, orderId);

    const itemResult = await db
      .select()
      .from(orderItems)
      .where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId)));

    if (itemResult.length === 0) {
      throw new NotFoundException(`Order item with ID "${itemId}" not found`);
    }

    await db
      .update(orderItems)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(orderItems.id, itemId));

    const restored = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.id, itemId));

    return restored[0];
  }
}
