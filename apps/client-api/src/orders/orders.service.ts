import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { eq, isNull, and, or, inArray, like, desc, lt, sql, type SQL } from 'drizzle-orm';
import { TenantDb, orders, orderItems, orderItemChanges, orderChanges, depTransactions, accounts, Order, OrderItem, OrderStatus } from '@org/database';
import { CreateOrderDto, UpdateOrderDto, CreateOrderItemDto } from './dto/index.js';

/** Strip leading 'S' prefix from serial numbers (e.g. S12345 -> 12345) */
function normalizeSerial(sn: string): string {
  return sn.startsWith('S') ? sn.slice(1) : sn;
}

// Order with items
export interface OrderWithItems extends Order {
  items: OrderItem[];
}

/**
 * Where a returned (soft-deleted) device is in the Apple return process:
 *  removed   – never enrolled at Apple, so there was nothing to return
 *  pending   – return queued, not yet sent to Apple
 *  submitted – return (RE) sent, awaiting Apple's result
 *  complete  – Apple confirmed the return
 *  error     – Apple rejected the return
 */
export type ReturnStatus = 'removed' | 'pending' | 'submitted' | 'complete' | 'error';

export interface ReturnedOrderItem extends OrderItem {
  returnStatus: ReturnStatus;
  returnedAt: Date | null;
}

export type AttentionType = 'order_error' | 'missing_dep_account' | 'unsynced_changes' | 'stuck_transaction';

export interface AttentionIssue {
  orderId: number;
  externalOrderId: string | null;
  type: AttentionType;
  message: string;
  since: Date | null;
}

/** Changes not pushed to Apple after this long are considered stuck (push runs every ~10 min) */
const UNSYNCED_AFTER_MS = 30 * 60 * 1000;
/** Apple transactions normally resolve within minutes */
const STUCK_TXN_AFTER_MS = 60 * 60 * 1000;
const ATTENTION_ROW_LIMIT = 500;
export type ActivityState = 'waiting' | 'sent' | 'in_progress' | 'complete' | 'error';

export interface ActivityEntry {
  kind: 'order_change' | 'item_change' | 'transaction';
  at: Date | null;
  title: string;
  detail: string | null;
  /** waiting = recorded but not yet pushed downstream; sent = pushed; the rest describe an Apple transaction */
  state: ActivityState;
}

const TXN_LABELS: Record<string, string> = {
  OR: 'Enrollment', RE: 'Return', VD: 'Void', OV: 'Override', SC: 'Status check',
};

export interface OrdersPageOptions {
  page: number;
  limit: number;
  search?: string;
  status?: OrderStatus;
}

export interface OrdersPage {
  items: OrderWithItems[];
  total: number;
  page: number;
  limit: number;
}

function deriveReturnStatus(
  item: OrderItem,
  change: { snapshot: string | null; syncedAt: Date | null } | undefined,
  txn: { status: string } | undefined,
): ReturnStatus {
  if (item.depStatus === 'error') return 'error';
  if (!change) return 'removed';
  let enrolled = false;
  try {
    const snap = JSON.parse(change.snapshot ?? '{}');
    enrolled = !!snap.isDep && (snap.depStatus === 'submitted' || snap.depStatus === 'complete');
  } catch { /* treat as not enrolled */ }
  if (!enrolled) return 'removed';
  if (!change.syncedAt) return 'pending';
  if (!txn) return 'submitted';
  if (txn.status === 'complete') return 'complete';
  if (txn.status === 'error' || txn.status === 'posted_with_errors') return 'error';
  return 'submitted';
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
   * Find a page of orders with optional search/status filter
   * (soft-deleted items excluded)
   */
  async findPage(db: TenantDb, opts: OrdersPageOptions): Promise<OrdersPage> {
    const conditions: SQL[] = [];
    if (opts.status) {
      conditions.push(eq(orders.status, opts.status));
    }
    const search = opts.search?.trim();
    if (search) {
      const pattern = `%${search}%`;
      // Serials are stored without the leading 'S' — normalize the search
      // term the same way the import does so "S12345" finds "12345"
      const serialPattern = `%${normalizeSerial(search)}%`;
      conditions.push(
        or(
          like(orders.orderId, pattern),
          like(orders.externalOrderId, pattern),
          like(orders.depOrderId, pattern),
          like(orders.po, pattern),
          like(orders.source, pattern),
          sql`EXISTS (SELECT 1 FROM ${orderItems} WHERE ${orderItems.orderId} = ${orders.id} AND ${orderItems.deletedAt} IS NULL AND ${orderItems.serialNumber} LIKE ${serialPattern})`,
        ) as SQL,
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ total }] = await db
      .select({ total: sql<number>`COUNT(*)` })
      .from(orders)
      .where(where);

    const pageRows = await db
      .select()
      .from(orders)
      .where(where)
      .orderBy(desc(orders.id))
      .limit(opts.limit)
      .offset((opts.page - 1) * opts.limit);

    // Single query for the whole page's items instead of one per order
    const orderIds = pageRows.map((o) => o.id);
    const items = orderIds.length > 0
      ? await db
          .select()
          .from(orderItems)
          .where(and(inArray(orderItems.orderId, orderIds), isNull(orderItems.deletedAt)))
      : [];

    const itemsByOrder = new Map<number, OrderItem[]>();
    for (const item of items) {
      const list = itemsByOrder.get(item.orderId) ?? [];
      list.push(item);
      itemsByOrder.set(item.orderId, list);
    }

    return {
      items: pageRows.map((o) => ({ ...o, items: itemsByOrder.get(o.id) ?? [] })),
      total: Number(total),
      page: opts.page,
      limit: opts.limit,
    };
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
   * Orders that need a human: Apple reported an error, changes that never got
   * pushed (and why), or Apple transactions that never resolved. Newest problem first.
   */
  async findNeedingAttention(db: TenantDb, now = new Date()): Promise<AttentionIssue[]> {
    const unsyncedCutoff = new Date(now.getTime() - UNSYNCED_AFTER_MS);
    const stuckCutoff = new Date(now.getTime() - STUCK_TXN_AFTER_MS);

    const errorOrders = await db
      .select()
      .from(orders)
      .where(eq(orders.status, 'error'))
      .limit(ATTENTION_ROW_LIMIT);
    const orderChangeRows = await db
      .select()
      .from(orderChanges)
      .where(and(isNull(orderChanges.syncedAt), lt(orderChanges.createdAt, unsyncedCutoff)))
      .limit(ATTENTION_ROW_LIMIT);
    const itemChangeRows = await db
      .select()
      .from(orderItemChanges)
      .where(and(isNull(orderItemChanges.syncedAt), lt(orderItemChanges.createdAt, unsyncedCutoff)))
      .limit(ATTENTION_ROW_LIMIT);
    const stuckTxns = await db
      .select()
      .from(depTransactions)
      .where(and(inArray(depTransactions.status, ['pending', 'in_progress']), lt(depTransactions.createdAt, stuckCutoff)))
      .limit(ATTENTION_ROW_LIMIT);

    // Oldest unsynced change per order
    const unsyncedSince = new Map<number, Date | null>();
    for (const row of [...orderChangeRows, ...itemChangeRows]) {
      const prev = unsyncedSince.get(row.orderId);
      const at = row.createdAt ?? null;
      if (prev === undefined || (at && (!prev || at < prev))) unsyncedSince.set(row.orderId, at);
    }

    const orderIds = [
      ...new Set([
        ...errorOrders.map((o) => o.id),
        ...unsyncedSince.keys(),
        ...stuckTxns.map((t) => t.orderId).filter((id): id is number => id != null),
      ]),
    ];
    if (orderIds.length === 0) return [];

    const orderRows = await db.select().from(orders).where(inArray(orders.id, orderIds));
    const orderById = new Map(orderRows.map((o) => [o.id, o]));
    const accountIds = [...new Set(orderRows.map((o) => o.accountId))];
    const accountRows = accountIds.length
      ? await db.select().from(accounts).where(inArray(accounts.id, accountIds))
      : [];
    const accountById = new Map(accountRows.map((a) => [a.id, a]));

    // Latest Apple error message per order, to explain 'error' status
    const errorTxns = errorOrders.length
      ? await db
          .select()
          .from(depTransactions)
          .where(and(
            inArray(depTransactions.orderId, errorOrders.map((o) => o.id)),
            inArray(depTransactions.status, ['error', 'posted_with_errors']),
          ))
          .orderBy(desc(depTransactions.id))
      : [];
    const lastError = new Map<number, string>();
    for (const t of errorTxns) {
      if (t.orderId != null && !lastError.has(t.orderId)) {
        lastError.set(t.orderId, t.errorMessage || t.errorCode || 'Apple reported an error');
      }
    }

    const issue = (orderId: number, type: AttentionType, message: string, since: Date | null): AttentionIssue => ({
      orderId,
      externalOrderId: orderById.get(orderId)?.externalOrderId ?? null,
      type,
      message,
      since,
    });

    const issues: AttentionIssue[] = [];
    for (const o of errorOrders) {
      issues.push(issue(o.id, 'order_error', lastError.get(o.id) ?? 'Apple reported a problem with this order.', o.updatedAt ?? null));
    }
    for (const [orderId, since] of unsyncedSince) {
      const order = orderById.get(orderId);
      const account = order ? accountById.get(order.accountId) : undefined;
      issues.push(
        account && !account.depAccountId
          ? issue(orderId, 'missing_dep_account', `Account "${account.name ?? account.externalAccountId ?? account.id}" has no Apple org ID, so changes cannot be sent to Apple.`, since)
          : issue(orderId, 'unsynced_changes', 'Changes have not been sent to Apple yet.', since),
      );
    }
    for (const t of stuckTxns) {
      if (t.orderId == null) continue;
      issues.push(issue(t.orderId, 'stuck_transaction', `Apple ${t.orderType} transaction has had no result for over an hour.`, t.createdAt ?? null));
    }

    return issues.sort((a, b) => (b.since?.getTime() ?? 0) - (a.since?.getTime() ?? 0));
  }

  /**
   * One newest-first timeline for an order: what changed (and whether the
   * change has been pushed yet) interleaved with the Apple transactions it
   * produced. Status checks are omitted — they're read-only noise.
   */
  async getActivity(db: TenantDb, orderId: number): Promise<ActivityEntry[]> {
    await this.findOne(db, orderId);
    const LIMIT = 200;

    const orderChangeRows = await db
      .select()
      .from(orderChanges)
      .where(eq(orderChanges.orderId, orderId))
      .orderBy(desc(orderChanges.id))
      .limit(LIMIT);
    const itemChangeRows = await db
      .select()
      .from(orderItemChanges)
      .where(eq(orderItemChanges.orderId, orderId))
      .orderBy(desc(orderItemChanges.id))
      .limit(LIMIT);
    const txnRows = await db
      .select()
      .from(depTransactions)
      .where(and(eq(depTransactions.orderId, orderId), sql`${depTransactions.orderType} <> 'SC'`))
      .orderBy(desc(depTransactions.id))
      .limit(LIMIT);

    const entries: ActivityEntry[] = [];
    for (const c of orderChangeRows) {
      let fields: string[] = [];
      try { fields = Object.keys(JSON.parse(c.changedFields ?? '{}')); } catch { /* ignore */ }
      entries.push({
        kind: 'order_change',
        at: c.createdAt ?? null,
        title: `Order ${c.changeType}`,
        detail: fields.length ? `Changed: ${fields.join(', ')}` : null,
        state: c.syncedAt ? 'sent' : 'waiting',
      });
    }
    for (const c of itemChangeRows) {
      entries.push({
        kind: 'item_change',
        at: c.createdAt ?? null,
        title: `Device ${c.changeType}: ${c.serialNumber}`,
        detail: null,
        state: c.syncedAt ? 'sent' : 'waiting',
      });
    }
    for (const t of txnRows) {
      entries.push({
        kind: 'transaction',
        at: t.createdAt ?? null,
        title: `${TXN_LABELS[t.orderType] ?? t.orderType} submitted to Apple`,
        detail: t.errorMessage ?? t.errorCode ?? null,
        state:
          t.status === 'complete' ? 'complete'
          : t.status === 'error' || t.status === 'posted_with_errors' ? 'error'
          : 'in_progress',
      });
    }

    return entries.sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
  }

  /**
   * Soft-deleted (returned) items on an order, each with the status of its
   * return at Apple derived from the 'removed' change and its RE/VD transaction
   */
  async findReturnedItems(db: TenantDb, orderId: number): Promise<ReturnedOrderItem[]> {
    const items = await db
      .select()
      .from(orderItems)
      .where(and(eq(orderItems.orderId, orderId), sql`${orderItems.deletedAt} IS NOT NULL`));
    if (items.length === 0) return [];

    const changes = await db
      .select()
      .from(orderItemChanges)
      .where(and(eq(orderItemChanges.orderId, orderId), eq(orderItemChanges.changeType, 'removed')))
      .orderBy(desc(orderItemChanges.id));
    const txns = await db
      .select()
      .from(depTransactions)
      .where(and(eq(depTransactions.orderId, orderId), inArray(depTransactions.orderType, ['RE', 'VD'])))
      .orderBy(desc(depTransactions.id));

    return items.map((item) => {
      const change = changes.find((c) => c.orderItemId === item.id || c.serialNumber === item.serialNumber);
      // Latest transaction created after the removal that mentions this serial
      const txn = change
        ? txns.find(
            (t) =>
              (!t.createdAt || !change.createdAt || t.createdAt >= change.createdAt) &&
              (t.requestPayload ?? '').includes(item.serialNumber),
          )
        : undefined;
      return {
        ...item,
        returnedAt: item.deletedAt,
        returnStatus: deriveReturnStatus(item, change, txn),
      };
    });
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
    // Normalize serial numbers (strip leading S) and validate uniqueness
    const serialNumbers = items.map((item) => normalizeSerial(item.serialNumber));
    await this.validateSerialNumbersUnique(db, serialNumbers);

    const now = new Date();

    for (const item of items) {
      await db.insert(orderItems).values({
        orderId,
        isDep: item.isDep ?? false,
        serialNumber: normalizeSerial(item.serialNumber),
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

    // Normalize serial number if provided
    const normalizedSerial = updateData.serialNumber !== undefined
      ? normalizeSerial(updateData.serialNumber)
      : undefined;

    // If updating serial number, validate it's unique (excluding current item)
    if (
      normalizedSerial !== undefined &&
      normalizedSerial !== itemResult[0].serialNumber
    ) {
      const existing = await db
        .select()
        .from(orderItems)
        .where(
          and(
            eq(orderItems.serialNumber, normalizedSerial),
            isNull(orderItems.deletedAt)
          )
        );

      if (existing.length > 0) {
        throw new ConflictException(
          `Serial number already exists: ${normalizedSerial}`
        );
      }
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (updateData.isDep !== undefined) update['isDep'] = updateData.isDep;
    if (normalizedSerial !== undefined) update['serialNumber'] = normalizedSerial;
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

    const item = itemResult[0];
    const now = new Date();

    await db
      .update(orderItems)
      .set({ deletedAt: now })
      .where(eq(orderItems.id, itemId));

    // Record the removal so the DEP push returns the device from Apple
    await db.insert(orderItemChanges).values({
      orderId,
      orderItemId: item.id,
      serialNumber: item.serialNumber,
      changeType: 'removed',
      snapshot: JSON.stringify({
        id: item.id,
        serialNumber: item.serialNumber,
        isDep: item.isDep,
        depStatus: item.depStatus,
      }),
      createdAt: now,
    });
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

    const now = new Date();
    await db
      .update(orderItems)
      .set({ deletedAt: null, updatedAt: now })
      .where(eq(orderItems.id, itemId));

    const restored = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.id, itemId));

    // Record the restore as an addition so the DEP push re-enrolls it
    // (removal recorded a 'removed' change and returned it from Apple)
    await db.insert(orderItemChanges).values({
      orderId,
      orderItemId: restored[0].id,
      serialNumber: restored[0].serialNumber,
      changeType: 'added',
      snapshot: JSON.stringify({
        serialNumber: restored[0].serialNumber,
        isDep: restored[0].isDep,
        depStatus: restored[0].depStatus,
      }),
      createdAt: now,
    });

    return restored[0];
  }
}
