import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { depTransactions } from '@org/database';
import { AccountRepositoryPort, OrderChangeRepositoryPort, OrderRepositoryPort } from '../domain/ports/repository.port.js';
import { OrderChangeEntity, OrderItemChangeEntity } from '../domain/entities/index.js';
import { DepSyncAdapter } from '../infrastructure/adapters/dep/dep-sync.adapter.js';
import { DepTransactionRepository } from '../infrastructure/repositories/dep-transaction.repository.js';
import { OrderEnrollmentData } from '../infrastructure/adapters/dep/dep-payload-builder.js';

export interface DepPushResult {
  totalOrders: number;
  submitted: number;
  failed: number;
  skipped: number;
  errors: string[];
}

interface GroupedChanges {
  orderChanges: OrderChangeEntity[];
  itemChanges: OrderItemChangeEntity[];
}

/**
 * Maps internal order changes to Apple DEP API calls.
 *
 * Change type mapping:
 *   order 'created'  + items 'added'   → OR (enroll devices)
 *   order 'deleted'                     → VD (void order)
 *   order 'updated'  (changed fields)  → OV (override order — replaces entire device list)
 *   items 'added'    (no order change)  → OR (add devices to existing order, same order number)
 *   items 'removed'                     → RE (return specific devices)
 */
@Injectable()
export class DepPushChangesUseCase {
  private readonly logger = new Logger(DepPushChangesUseCase.name);

  async execute(
    changeRepo: OrderChangeRepositoryPort,
    orderRepo: OrderRepositoryPort,
    depAdapter: DepSyncAdapter,
    txnRepo: DepTransactionRepository,
    accountRepo: AccountRepositoryPort,
  ): Promise<DepPushResult> {
    const result: DepPushResult = {
      totalOrders: 0,
      submitted: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };

    const unsyncedChanges = await changeRepo.findUnsyncedChanges();

    if (unsyncedChanges.orderChanges.length === 0 && unsyncedChanges.itemChanges.length === 0) {
      return result;
    }

    // Group by order ID
    const grouped = this.groupByOrder(unsyncedChanges.orderChanges, unsyncedChanges.itemChanges);
    result.totalOrders = grouped.size;

    for (const [orderId, changes] of grouped) {
      try {
        const order = await orderRepo.findById(orderId);
        if (!order) {
          this.logger.warn(`Order ${orderId} not found, skipping`);
          result.skipped++;
          continue;
        }

        // Only process DEP-eligible orders
        if (!order.isDep) {
          result.skipped++;
          // Mark as synced so we don't keep retrying non-DEP orders
          await this.markSynced(changeRepo, changes);
          continue;
        }

        // Resolve the Apple org ID from the order's account. Never fall back
        // to reseller-side IDs — Apple rejects them with DEP-ERR-OR-4102.
        const account = order.accountId ? await accountRepo.findById(order.accountId) : null;
        const customerId = account?.depAccountId;
        if (!customerId) {
          this.logger.warn(
            `Order ${orderId} account has no DEP account ID (Apple org ID) — skipping until accounts sync provides one`,
          );
          result.skipped++;
          continue; // leave changes unsynced so this retries once the account is fixed
        }

        const orderChange = changes.orderChanges[0];
        const addedItems = changes.itemChanges.filter((i) => i.changeType === 'added');
        const removedItems = changes.itemChanges.filter((i) => i.changeType === 'removed');

        // Determine which DEP operations to perform
        if (orderChange?.changeType === 'deleted') {
          // Order deleted → Void (VD)
          await this.submitVoid(depAdapter, txnRepo, order, customerId);
          result.submitted++;
          await this.markSynced(changeRepo, changes);
        } else if (orderChange?.changeType === 'created') {
          // New order → Enroll (OR) all DEP items
          const depItems = order.items.filter((i) => i.isDep);
          if (depItems.length === 0) {
            result.skipped++;
            await this.markSynced(changeRepo, changes);
            continue;
          }
          await this.submitEnroll(depAdapter, txnRepo, order, depItems, customerId);
          result.submitted++;
          await this.markSynced(changeRepo, changes);
        } else if (orderChange?.changeType === 'updated') {
          // Order fields changed → Override (OV) with current full device list
          const depItems = order.items.filter((i) => i.isDep);
          if (depItems.length === 0) {
            // All devices removed — void instead
            await this.submitVoid(depAdapter, txnRepo, order, customerId);
          } else {
            await this.submitOverride(depAdapter, txnRepo, order, depItems, customerId);
          }
          result.submitted++;
          await this.markSynced(changeRepo, changes);
        } else {
          // Item-only changes (no order-level change)
          let didSubmit = false;

          // Handle removed items → Return (RE)
          if (removedItems.length > 0) {
            await this.submitReturn(depAdapter, txnRepo, order, removedItems, customerId);
            didSubmit = true;
          }

          // Handle added items → Enroll (OR) additional devices
          if (addedItems.length > 0) {
            const devices = addedItems
              .filter((i) => {
                const item = order.items.find((oi) => oi.serialNumber === i.serialNumber);
                return item?.isDep;
              });
            if (devices.length > 0) {
              await this.submitAddDevices(depAdapter, txnRepo, order, devices, customerId);
              didSubmit = true;
            }
          }

          if (didSubmit) {
            result.submitted++;
          } else {
            result.skipped++;
          }
          await this.markSynced(changeRepo, changes);
        }
      } catch (error: any) {
        const msg = error instanceof Error ? error.message : String(error);
        result.failed++;
        result.errors.push(`Order ${orderId}: ${msg}`);
        this.logger.error(`Failed to push DEP changes for order ${orderId}: ${msg}`);
      }
    }

    this.logger.log(
      `DEP push complete: ${result.submitted} submitted, ${result.failed} failed, ${result.skipped} skipped`,
    );

    return result;
  }

  // ---- Submit helpers ----

  private async submitEnroll(
    adapter: DepSyncAdapter,
    txnRepo: DepTransactionRepository,
    order: any,
    depItems: any[],
    customerId: string,
  ) {
    const txnId = uuidv4().replace(/-/g, "").slice(0, 20);
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

    const dbTxnId = await txnRepo.create({
      orderId: order.id,
      transactionId: txnId,
      orderType: 'OR',
      status: 'pending',
    });

    const enrollData: OrderEnrollmentData[] = [{
      orderNumber: order.depOrderId || order.externalOrderId,
      orderDate: order.depOrderedAt?.toISOString().replace(/\.\d+Z$/, 'Z') || now,
      orderType: 'OR',
      customerId,
      poNumber: order.po,
      deliveries: [{
        deliveryNumber: `DEL_${order.depOrderId || order.externalOrderId}`,
        shipDate: order.depShippedAt?.toISOString().replace(/\.\d+Z$/, 'Z') || now,
        devices: depItems.map((item) => ({ serialNumber: item.serialNumber })),
      }],
    }];

    try {
      const { request, response } = await adapter.bulkEnrollDevices(txnId, enrollData);
      await txnRepo.updateStatus(dbTxnId, response.deviceEnrollmentTransactionId ? 'in_progress' : 'error', {
        responsePayload: JSON.stringify(response),
        deviceEnrollmentTransactionId: response.deviceEnrollmentTransactionId,
        errorCode: response.errorCode || (response.enrollDeviceErrorResponse as any)?.errorCode,
        errorMessage: response.errorMessage,
      });
      // Store request
      await this.storeRequest(txnRepo, dbTxnId, request);
      this.logger.log(`OR submitted for order ${order.depOrderId || order.externalOrderId}: ${response.deviceEnrollmentTransactionId || 'error'}`);
    } catch (err: any) {
      await txnRepo.updateStatus(dbTxnId, 'error', { errorMessage: err.message });
      throw err;
    }
  }

  private async submitReturn(
    adapter: DepSyncAdapter,
    txnRepo: DepTransactionRepository,
    order: any,
    removedItems: OrderItemChangeEntity[],
    customerId: string,
  ) {
    const txnId = uuidv4().replace(/-/g, "").slice(0, 20);
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const returnOrderNumber = `${order.depOrderId || order.externalOrderId}_RE_${Date.now()}`;

    const dbTxnId = await txnRepo.create({
      orderId: order.id,
      transactionId: txnId,
      orderType: 'RE',
      status: 'pending',
    });

    const enrollData: OrderEnrollmentData[] = [{
      orderNumber: returnOrderNumber,
      orderDate: now,
      orderType: 'RE',
      customerId,
      poNumber: order.po,
      deliveries: [{
        deliveryNumber: `RET_${order.depOrderId || order.externalOrderId}`,
        shipDate: now,
        devices: removedItems.map((item) => ({ serialNumber: item.serialNumber })),
      }],
    }];

    try {
      const { request, response } = await adapter.bulkEnrollDevices(txnId, enrollData);
      await txnRepo.updateStatus(dbTxnId, response.deviceEnrollmentTransactionId ? 'in_progress' : 'error', {
        responsePayload: JSON.stringify(response),
        deviceEnrollmentTransactionId: response.deviceEnrollmentTransactionId,
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
      });
      await this.storeRequest(txnRepo, dbTxnId, request);
      this.logger.log(`RE submitted for order ${order.depOrderId || order.externalOrderId}: ${removedItems.length} devices`);
    } catch (err: any) {
      await txnRepo.updateStatus(dbTxnId, 'error', { errorMessage: err.message });
      throw err;
    }
  }

  private async submitOverride(
    adapter: DepSyncAdapter,
    txnRepo: DepTransactionRepository,
    order: any,
    depItems: any[],
    customerId: string,
  ) {
    const txnId = uuidv4().replace(/-/g, "").slice(0, 20);
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

    const dbTxnId = await txnRepo.create({
      orderId: order.id,
      transactionId: txnId,
      orderType: 'OV',
      status: 'pending',
    });

    const enrollData: OrderEnrollmentData[] = [{
      orderNumber: order.depOrderId || order.externalOrderId,
      orderDate: order.depOrderedAt?.toISOString().replace(/\.\d+Z$/, 'Z') || now,
      orderType: 'OV',
      customerId,
      poNumber: order.po,
      deliveries: [{
        deliveryNumber: 'SELF',
        shipDate: order.depShippedAt?.toISOString().replace(/\.\d+Z$/, 'Z') || now,
        devices: depItems.map((item) => ({ serialNumber: item.serialNumber })),
      }],
    }];

    try {
      const { request, response } = await adapter.bulkEnrollDevices(txnId, enrollData);
      await txnRepo.updateStatus(dbTxnId, response.deviceEnrollmentTransactionId ? 'in_progress' : 'error', {
        responsePayload: JSON.stringify(response),
        deviceEnrollmentTransactionId: response.deviceEnrollmentTransactionId,
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
      });
      await this.storeRequest(txnRepo, dbTxnId, request);
      this.logger.log(`OV submitted for order ${order.depOrderId || order.externalOrderId}: ${depItems.length} devices`);
    } catch (err: any) {
      await txnRepo.updateStatus(dbTxnId, 'error', { errorMessage: err.message });
      throw err;
    }
  }

  private async submitVoid(
    adapter: DepSyncAdapter,
    txnRepo: DepTransactionRepository,
    order: any,
    customerId: string,
  ) {
    const txnId = uuidv4().replace(/-/g, "").slice(0, 20);
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

    const dbTxnId = await txnRepo.create({
      orderId: order.id,
      transactionId: txnId,
      orderType: 'VD',
      status: 'pending',
    });

    const enrollData: OrderEnrollmentData[] = [{
      orderNumber: order.depOrderId || order.externalOrderId,
      orderDate: order.depOrderedAt?.toISOString().replace(/\.\d+Z$/, 'Z') || now,
      orderType: 'VD',
      customerId,
      poNumber: order.po,
      deliveries: [],
    }];

    try {
      const { request, response } = await adapter.bulkEnrollDevices(txnId, enrollData);
      await txnRepo.updateStatus(dbTxnId, response.deviceEnrollmentTransactionId ? 'in_progress' : 'error', {
        responsePayload: JSON.stringify(response),
        deviceEnrollmentTransactionId: response.deviceEnrollmentTransactionId,
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
      });
      await this.storeRequest(txnRepo, dbTxnId, request);
      this.logger.log(`VD submitted for order ${order.depOrderId || order.externalOrderId}`);
    } catch (err: any) {
      await txnRepo.updateStatus(dbTxnId, 'error', { errorMessage: err.message });
      throw err;
    }
  }

  private async submitAddDevices(
    adapter: DepSyncAdapter,
    txnRepo: DepTransactionRepository,
    order: any,
    addedItems: OrderItemChangeEntity[],
    customerId: string,
  ) {
    const txnId = uuidv4().replace(/-/g, "").slice(0, 20);
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

    const dbTxnId = await txnRepo.create({
      orderId: order.id,
      transactionId: txnId,
      orderType: 'OR',
      status: 'pending',
    });

    // Adding devices to existing order — same order number, new delivery
    const enrollData: OrderEnrollmentData[] = [{
      orderNumber: order.depOrderId || order.externalOrderId,
      orderDate: order.depOrderedAt?.toISOString().replace(/\.\d+Z$/, 'Z') || now,
      orderType: 'OR',
      customerId,
      poNumber: order.po,
      deliveries: [{
        deliveryNumber: `DEL_${order.depOrderId || order.externalOrderId}_${Date.now()}`,
        shipDate: now,
        devices: addedItems.map((item) => ({ serialNumber: item.serialNumber })),
      }],
    }];

    try {
      const { request, response } = await adapter.bulkEnrollDevices(txnId, enrollData);
      await txnRepo.updateStatus(dbTxnId, response.deviceEnrollmentTransactionId ? 'in_progress' : 'error', {
        responsePayload: JSON.stringify(response),
        deviceEnrollmentTransactionId: response.deviceEnrollmentTransactionId,
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
      });
      await this.storeRequest(txnRepo, dbTxnId, request);
      this.logger.log(`OR (add devices) submitted for order ${order.depOrderId || order.externalOrderId}: ${addedItems.length} devices`);
    } catch (err: any) {
      await txnRepo.updateStatus(dbTxnId, 'error', { errorMessage: err.message });
      throw err;
    }
  }

  // ---- Utilities ----

  private groupByOrder(
    orderChanges: OrderChangeEntity[],
    itemChanges: OrderItemChangeEntity[],
  ): Map<number, GroupedChanges> {
    const map = new Map<number, GroupedChanges>();

    for (const c of orderChanges) {
      if (!map.has(c.orderId)) map.set(c.orderId, { orderChanges: [], itemChanges: [] });
      map.get(c.orderId)!.orderChanges.push(c);
    }
    for (const c of itemChanges) {
      if (!map.has(c.orderId)) map.set(c.orderId, { orderChanges: [], itemChanges: [] });
      map.get(c.orderId)!.itemChanges.push(c);
    }

    return map;
  }

  private async markSynced(changeRepo: OrderChangeRepositoryPort, changes: GroupedChanges) {
    const orderIds = changes.orderChanges.filter((c) => c.id).map((c) => c.id!);
    const itemIds = changes.itemChanges.filter((c) => c.id).map((c) => c.id!);
    if (orderIds.length > 0) await changeRepo.markOrderChangesSynced(orderIds);
    if (itemIds.length > 0) await changeRepo.markItemChangesSynced(itemIds);
  }

  private async storeRequest(txnRepo: DepTransactionRepository, dbTxnId: number, request: unknown) {
    try {
      const db = (txnRepo as unknown as { db?: unknown }).db as
        | { update: (table: unknown) => { set: (data: unknown) => { where: (cond: unknown) => Promise<unknown> } } }
        | undefined;
      if (db) {
        await db.update(depTransactions).set({ requestPayload: JSON.stringify(request) }).where(eq(depTransactions.id, dbTxnId));
      }
    } catch { /* non-critical */ }
  }
}
