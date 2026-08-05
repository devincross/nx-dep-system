import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and, desc, inArray, isNull } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import * as https from 'https';
import {
  TenantDb,
  orders,
  orderItems,
  accounts,
  depTransactions,
} from '@org/database';
import { CredentialsService } from '../credentials/credentials.service.js';
import { NetsuiteService } from '../netsuite/netsuite.service.js';
import type { TenantContext } from '../tenant/tenant-context.service.js';

interface DepCredentials {
  apiUrl: string;
  shipTo: string;
  depResellerId: string;
  sslKey: string;
  sslCert: string;
}

@Injectable()
export class DepActionsService {
  private readonly logger = new Logger(DepActionsService.name);

  constructor(
    private readonly credentialsService: CredentialsService,
    private readonly netsuiteService: NetsuiteService,
  ) {}

  async enrollOrder(db: TenantDb, orderId: number, customerId?: string) {
    const { order, items, cred, resolvedCustomerId } = await this.loadOrderAndCreds(db, orderId, customerId);
    const depItems = items.filter((i) => i.isDep && !i.deletedAt);
    if (depItems.length === 0) throw new BadRequestException('No DEP-eligible devices on this order');

    const txnId = uuidv4().replace(/-/g, "").slice(0, 20);
    const now = this.formatDate(new Date());

    const request = this.buildBulkEnrollRequest(cred, txnId, [{
      orderNumber: order.depOrderId || order.externalOrderId || String(order.id),
      orderDate: order.depOrderedAt ? this.formatDate(order.depOrderedAt) : now,
      orderType: 'OR',
      customerId: resolvedCustomerId,
      poNumber: order.po || undefined,
      deliveries: [{
        deliveryNumber: `DEL_${order.depOrderId || order.externalOrderId || order.id}`,
        shipDate: order.depShippedAt ? this.formatDate(order.depShippedAt) : now,
        devices: depItems.map((i) => ({ deviceId: i.serialNumber })),
      }],
    }]);

    const response = await this.callDep(cred, '/enroll-service/1.0/bulk-enroll-devices', request);
    await this.logTransaction(db, orderId, txnId, 'OR', request, response);

    // Update order and item statuses after successful enrollment submission
    const resp = response as any;
    if (resp.deviceEnrollmentTransactionId) {
      await db.update(orders)
        .set({ status: 'submitted', updatedAt: new Date() })
        .where(eq(orders.id, orderId));
      for (const item of depItems) {
        await db.update(orderItems)
          .set({ depStatus: 'submitted', updatedAt: new Date() })
          .where(eq(orderItems.id, item.id));
      }
    }

    return { transactionId: txnId, response };
  }

  async returnDevices(db: TenantDb, orderId: number, serialNumbers?: string[]) {
    const { order, items, cred, resolvedCustomerId } = await this.loadOrderAndCreds(db, orderId);
    const depItems = serialNumbers?.length
      ? items.filter((i) => serialNumbers.includes(i.serialNumber))
      : items.filter((i) => i.isDep && !i.deletedAt);
    if (depItems.length === 0) throw new BadRequestException('No devices to return');

    const txnId = uuidv4().replace(/-/g, "").slice(0, 20);
    const now = this.formatDate(new Date());
    const returnOrderNum = `${order.depOrderId || order.externalOrderId || order.id}_RE_${Date.now()}`;

    const request = this.buildBulkEnrollRequest(cred, txnId, [{
      orderNumber: returnOrderNum,
      orderDate: now,
      orderType: 'RE',
      customerId: resolvedCustomerId,
      poNumber: order.po || undefined,
      deliveries: [{
        deliveryNumber: `RET_${order.depOrderId || order.externalOrderId || order.id}`,
        shipDate: now,
        devices: depItems.map((i) => ({ deviceId: i.serialNumber })),
      }],
    }]);

    const response = await this.callDep(cred, '/enroll-service/1.0/bulk-enroll-devices', request);
    await this.logTransaction(db, orderId, txnId, 'RE', request, response);
    return { transactionId: txnId, response };
  }

  async voidOrder(db: TenantDb, orderId: number) {
    const { order, cred, resolvedCustomerId } = await this.loadOrderAndCreds(db, orderId);
    const txnId = uuidv4().replace(/-/g, "").slice(0, 20);
    const now = this.formatDate(new Date());

    const request = this.buildBulkEnrollRequest(cred, txnId, [{
      orderNumber: order.depOrderId || order.externalOrderId || String(order.id),
      orderDate: order.depOrderedAt ? this.formatDate(order.depOrderedAt) : now,
      orderType: 'VD',
      customerId: resolvedCustomerId,
      poNumber: order.po || undefined,
    }]);

    const response = await this.callDep(cred, '/enroll-service/1.0/bulk-enroll-devices', request);
    await this.logTransaction(db, orderId, txnId, 'VD', request, response);
    return { transactionId: txnId, response };
  }

  async overrideOrder(db: TenantDb, orderId: number, customerId?: string) {
    const { order, items, cred, resolvedCustomerId } = await this.loadOrderAndCreds(db, orderId, customerId);
    const depItems = items.filter((i) => i.isDep && !i.deletedAt);
    if (depItems.length === 0) throw new BadRequestException('No DEP-eligible devices on this order');

    const txnId = uuidv4().replace(/-/g, "").slice(0, 20);
    const now = this.formatDate(new Date());

    const request = this.buildBulkEnrollRequest(cred, txnId, [{
      orderNumber: order.depOrderId || order.externalOrderId || String(order.id),
      orderDate: order.depOrderedAt ? this.formatDate(order.depOrderedAt) : now,
      orderType: 'OV',
      customerId: resolvedCustomerId,
      poNumber: order.po || undefined,
      deliveries: [{
        deliveryNumber: 'SELF',
        shipDate: order.depShippedAt ? this.formatDate(order.depShippedAt) : now,
        devices: depItems.map((i) => ({ deviceId: i.serialNumber })),
      }],
    }]);

    const response = await this.callDep(cred, '/enroll-service/1.0/bulk-enroll-devices', request);
    await this.logTransaction(db, orderId, txnId, 'OV', request, response);
    return { transactionId: txnId, response };
  }

  async getDepStatus(db: TenantDb, orderId: number) {
    const txns = await db
      .select()
      .from(depTransactions)
      .where(eq(depTransactions.orderId, orderId));
    return { orderId, transactions: txns };
  }

  async showDepOrderDetails(db: TenantDb, orderId: number) {
    const { order, cred } = await this.loadOrderAndCreds(db, orderId);
    const orderNumber = order.depOrderId || order.externalOrderId || String(order.id);

    const request = {
      requestContext: { shipTo: cred.shipTo, timeZone: '420', langCode: 'en' },
      depResellerId: cred.depResellerId,
      orderNumbers: [orderNumber],
    };

    const response = await this.callDep(cred, '/enroll-service/1.0/show-order-details', request);
    await this.logTransaction(db, orderId, `QRY_${Date.now()}`, 'SC', request, response);
    return { orderNumber, request, response };
  }

  /**
   * Check DEP enrollment status from Apple and update order/item statuses.
   * Calls show-order-details, matches devices to our items, and updates
   * depStatus on each item. If all DEP items are enrolled, marks the order complete.
   */
  async checkAndUpdateDepStatus(db: TenantDb, orderId: number) {
    const { order, items, cred } = await this.loadOrderAndCreds(db, orderId);
    const orderNumber = order.depOrderId || order.externalOrderId || String(order.id);

    const request = {
      requestContext: { shipTo: cred.shipTo, timeZone: '420', langCode: 'en' },
      depResellerId: cred.depResellerId,
      orderNumbers: [orderNumber],
    };

    const response = await this.callDep(cred, '/enroll-service/1.0/show-order-details', request) as any;
    await this.logTransaction(db, orderId, `CHK_${Date.now()}`, 'SC', request, response);

    // Collect enrolled device serials from Apple's response
    const enrolledSerials = new Set<string>();
    for (const depOrder of response.orders ?? []) {
      for (const delivery of depOrder.deliveries ?? []) {
        for (const device of delivery.devices ?? []) {
          if (device.deviceId) {
            enrolledSerials.add(device.deviceId);
          }
        }
      }
    }

    this.logger.log(`[checkAndUpdateDepStatus] Order ${orderId}: Apple reports ${enrolledSerials.size} enrolled devices`);

    // Update each DEP item's status
    const depItems = items.filter((i) => i.isDep && !i.deletedAt);
    let completedCount = 0;

    for (const item of depItems) {
      const isEnrolled = enrolledSerials.has(item.serialNumber);
      const newStatus = isEnrolled ? 'complete' : item.depStatus;

      if (newStatus !== item.depStatus) {
        await db.update(orderItems)
          .set({ depStatus: newStatus, updatedAt: new Date() })
          .where(eq(orderItems.id, item.id));
      }

      if (isEnrolled) completedCount++;
    }

    // Update order status based on item completion
    let newOrderStatus = order.status;
    if (depItems.length > 0 && completedCount === depItems.length) {
      newOrderStatus = 'complete';
    } else if (completedCount > 0) {
      newOrderStatus = 'submitted';
    }

    if (newOrderStatus !== order.status) {
      await db.update(orders)
        .set({ status: newOrderStatus, updatedAt: new Date() })
        .where(eq(orders.id, orderId));

      // Fully enrolled — reflect it on the NetSuite order
      if (newOrderStatus === 'complete') {
        await this.pushDepStatusToNetsuite(db, order.externalOrderId, 'Complete', 'Complete');
      }
    }

    this.logger.log(`[checkAndUpdateDepStatus] Order ${orderId}: ${completedCount}/${depItems.length} enrolled, status: ${order.status} → ${newOrderStatus}`);

    return {
      orderId,
      orderNumber,
      depItemCount: depItems.length,
      enrolledCount: completedCount,
      previousStatus: order.status,
      newStatus: newOrderStatus,
      enrolledSerials: [...enrolledSerials],
    };
  }

  /**
   * Check the status of a specific DEP transaction by its db id.
   * Calls Apple's check-transaction-status endpoint, which is the only way to
   * see per-device errors after Apple's async ingest of an enroll/return/void.
   * Same call the cron makes, but on-demand and scoped to one transaction.
   */
  async checkTransactionStatus(db: TenantDb, txnDbId: number) {
    const rows = await db
      .select()
      .from(depTransactions)
      .where(eq(depTransactions.id, txnDbId))
      .limit(1);

    const txn = rows[0];
    if (!txn) {
      throw new NotFoundException(`DEP transaction ${txnDbId} not found`);
    }
    if (!txn.deviceEnrollmentTransactionId) {
      throw new BadRequestException(
        'This transaction has no deviceEnrollmentTransactionId — Apple never accepted the submission (check the response payload for the rejection)',
      );
    }
    if (!txn.orderId) {
      throw new BadRequestException('Transaction is not linked to an order');
    }

    const { order, cred } = await this.loadOrderAndCreds(db, txn.orderId);

    const request = {
      requestContext: { shipTo: cred.shipTo, timeZone: '420', langCode: 'en' },
      depResellerId: cred.depResellerId,
      deviceEnrollmentTransactionId: txn.deviceEnrollmentTransactionId,
    };

    const response = await this.callDep(
      cred,
      '/enroll-service/1.0/check-transaction-status',
      request,
    ) as any;

    // Mirror the cron's status mapping
    let status: 'pending' | 'in_progress' | 'complete' | 'error' | 'posted_with_errors';
    let errorCode: string | null = null;
    let errorMessage: string | null = null;
    let completedAt: Date | null = null;

    if (response.statusCode === 'COMPLETE') {
      status = 'complete';
      completedAt = response.completedOn ? new Date(response.completedOn) : new Date();
    } else if (response.statusCode === 'COMPLETE_WITH_ERRORS') {
      status = 'posted_with_errors';
      errorCode = response.errorCode ?? null;
      errorMessage = this.extractAnyErrorMessage(response);
      completedAt = response.completedOn ? new Date(response.completedOn) : new Date();
    } else if (response.statusCode === 'ERROR') {
      status = 'error';
      errorCode = response.errorCode ?? null;
      errorMessage = this.extractAnyErrorMessage(response);
      completedAt = response.completedOn ? new Date(response.completedOn) : new Date();
    } else if (Array.isArray(response.checkTransactionErrorResponse) && response.checkTransactionErrorResponse.length > 0) {
      const errors = response.checkTransactionErrorResponse;
      const inProgress = errors.some((e: { errorCode?: string }) => e.errorCode === 'DEP-ERR-4003');
      if (inProgress) {
        status = 'in_progress';
      } else {
        status = 'error';
        errorCode = errors[0].errorCode ?? null;
        errorMessage = errors
          .map((e: { errorCode?: string; errorMessage?: string }) => `${e.errorCode}: ${e.errorMessage}`)
          .join('; ');
      }
    } else {
      status = 'in_progress';
    }

    await db.update(depTransactions)
      .set({
        status,
        responsePayload: JSON.stringify(response),
        errorCode: errorCode ?? undefined,
        errorMessage: errorMessage ?? undefined,
        completedAt: completedAt ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(depTransactions.id, txn.id));

    // Propagate the outcome to the order and its devices so the order
    // doesn't sit in 'submitted' after Apple has resolved the transaction
    await this.applyCheckOutcomeToOrder(
      db,
      txn.orderId,
      txn.orderType,
      txn.requestPayload,
      status,
      response,
    );

    // Reflect the resolved outcome on the NetSuite order
    if (status === 'complete') {
      const depResponse = txn.orderType === 'RE' ? 'Return Complete'
        : txn.orderType === 'VD' ? 'Void Complete'
        : 'Complete';
      await this.pushDepStatusToNetsuite(db, order.externalOrderId, depResponse, 'Complete');
    } else if (status === 'error' || status === 'posted_with_errors') {
      await this.pushDepStatusToNetsuite(
        db,
        order.externalOrderId,
        errorMessage || 'There is a problem with this order',
        'Error',
      );
    }

    return {
      transactionId: txn.transactionId,
      deviceEnrollmentTransactionId: txn.deviceEnrollmentTransactionId,
      status,
      errorCode,
      errorMessage,
      response,
    };
  }

  /**
   * Reflect a resolved transaction on the order and its devices:
   * - error: order → error, failing devices → error
   * - complete (OR/OV): enrolled devices → complete; order → complete
   *   once every DEP device on the order is complete
   * - posted_with_errors: enrolled devices → complete, failing → error,
   *   order → error so it surfaces for manual attention
   * RE/VD completions only resolve the transaction, not device statuses.
   */
  private async applyCheckOutcomeToOrder(
    db: TenantDb,
    orderId: number,
    orderType: string,
    requestPayload: string | null,
    status: 'pending' | 'in_progress' | 'complete' | 'error' | 'posted_with_errors',
    response: any,
  ): Promise<void> {
    if (status === 'error') {
      await db.update(orders)
        .set({ status: 'error', updatedAt: new Date() })
        .where(eq(orders.id, orderId));

      const failingSerials = this.extractFailingDeviceIds(response);
      if (failingSerials.length > 0) {
        await db.update(orderItems)
          .set({ depStatus: 'error', updatedAt: new Date() })
          .where(and(
            eq(orderItems.orderId, orderId),
            inArray(orderItems.serialNumber, failingSerials),
          ));
      }
      return;
    }

    if (status !== 'complete' && status !== 'posted_with_errors') return;

    // Enrollment transactions mark their devices complete; returns/voids don't
    if (orderType === 'OR' || orderType === 'OV') {
      let completedSerials = this.extractCompletedDeviceIds(response);
      if (completedSerials.length === 0 && status === 'complete') {
        // Apple sometimes returns no device detail — fall back to the
        // devices we submitted in the original request
        completedSerials = this.deviceIdsFromRequestPayload(requestPayload);
      }
      if (completedSerials.length > 0) {
        await db.update(orderItems)
          .set({ depStatus: 'complete', updatedAt: new Date() })
          .where(and(
            eq(orderItems.orderId, orderId),
            inArray(orderItems.serialNumber, completedSerials),
          ));
      }
    }

    if (status === 'posted_with_errors') {
      const failingSerials = this.extractFailingDeviceIds(response);
      if (failingSerials.length > 0) {
        await db.update(orderItems)
          .set({ depStatus: 'error', updatedAt: new Date() })
          .where(and(
            eq(orderItems.orderId, orderId),
            inArray(orderItems.serialNumber, failingSerials),
          ));
      }
      await db.update(orders)
        .set({ status: 'error', updatedAt: new Date() })
        .where(eq(orders.id, orderId));
      return;
    }

    // Fully complete enrollment: order → complete once every DEP device is
    if (orderType === 'OR' || orderType === 'OV') {
      const items = await db.select().from(orderItems)
        .where(and(eq(orderItems.orderId, orderId), isNull(orderItems.deletedAt)));
      const depItems = items.filter((i) => i.isDep);
      if (depItems.length > 0 && depItems.every((i) => i.depStatus === 'complete')) {
        await db.update(orders)
          .set({ status: 'complete', updatedAt: new Date() })
          .where(eq(orders.id, orderId));
      }
    }
  }

  private extractCompletedDeviceIds(response: any): string[] {
    const serials: string[] = [];
    for (const order of response.orders ?? []) {
      for (const delivery of order.deliveries ?? []) {
        for (const device of delivery.devices ?? []) {
          if (device.deviceId && device.devicePostStatus === 'COMPLETE') {
            serials.push(device.deviceId);
          }
        }
      }
    }
    return serials;
  }

  private deviceIdsFromRequestPayload(requestPayload: string | null): string[] {
    if (!requestPayload) return [];
    try {
      const req = JSON.parse(requestPayload);
      const serials: string[] = [];
      for (const order of req.orders ?? []) {
        for (const delivery of order.deliveries ?? []) {
          for (const device of delivery.devices ?? []) {
            if (device.deviceId) serials.push(device.deviceId);
          }
        }
      }
      return serials;
    } catch {
      return [];
    }
  }

  private extractFailingDeviceIds(response: any): string[] {
    const serials: string[] = [];
    for (const order of response.orders ?? []) {
      for (const delivery of order.deliveries ?? []) {
        for (const device of delivery.devices ?? []) {
          if (device.deviceId && device.devicePostStatus && device.devicePostStatus !== 'COMPLETE') {
            serials.push(device.deviceId);
          }
        }
      }
    }
    return serials;
  }

  private extractAnyErrorMessage(response: any): string {
    const messages: string[] = [];

    // Top-level error
    if (response.errorMessage) {
      messages.push(
        response.errorCode ? `${response.errorCode}: ${response.errorMessage}` : response.errorMessage,
      );
    }

    // Array-of-errors variant
    if (Array.isArray(response.checkTransactionErrorResponse)) {
      for (const e of response.checkTransactionErrorResponse) {
        if (e?.errorMessage || e?.errorCode) {
          messages.push(`${e.errorCode ?? ''}: ${e.errorMessage ?? ''}`.replace(/^: /, ''));
        }
      }
    }

    // enrollDeviceErrorResponse — appears on enroll failures echoed back via status check
    const ede = response.enrollDeviceErrorResponse;
    if (ede?.errorMessage || ede?.errorCode) {
      messages.push(`${ede.errorCode ?? ''}: ${ede.errorMessage ?? ''}`.replace(/^: /, ''));
    }

    // Per-order errors
    for (const order of response.orders ?? []) {
      if (Array.isArray(order.orderErrorMessages)) {
        for (const m of order.orderErrorMessages) {
          messages.push(typeof m === 'string' ? m : JSON.stringify(m));
        }
      }
      // Per-device errors
      for (const delivery of order.deliveries ?? []) {
        for (const device of delivery.devices ?? []) {
          if (device.devicePostStatus && device.devicePostStatus !== 'COMPLETE') {
            messages.push(
              `${device.deviceId}: ${device.devicePostStatus} - ${device.devicePostStatusMessage || ''}`,
            );
          }
        }
      }
    }

    // Fallback to a trimmed snippet of the full response so the user can see SOMETHING
    if (messages.length === 0) {
      return `No structured error fields; raw response: ${JSON.stringify(response).slice(0, 400)}`;
    }

    return messages.join('; ');
  }

  /**
   * Reconcile: compare our DB with Apple DEP and update our statuses to match.
   *
   * - Order found in DEP: devices Apple has enrolled are marked complete;
   *   order status becomes complete (all DEP devices enrolled) or
   *   submitted (some enrolled).
   * - Order not in DEP + an error recorded on our side: left unchanged
   *   for manual review.
   * - Order not in DEP + no error: flagged 'pending' so it's visible as
   *   needing enrollment.
   * No statuses are touched if the Apple query itself fails.
   */
  async reconcileOrders(tenant: TenantContext, orderIds?: number[]) {
    const db = tenant.db;

    // Get orders from our DB
    let dbOrders;
    if (orderIds?.length) {
      dbOrders = await db.select().from(orders).where(inArray(orders.id, orderIds));
    } else {
      dbOrders = await db.select().from(orders).limit(50);
    }

    if (dbOrders.length === 0) return { comparisons: [] };

    // Get DEP credentials
    const depCred = await this.getDepCredentials(db);

    // Get items for all orders
    const allOrderIds = dbOrders.map((o) => o.id);
    const allItems = await db
      .select()
      .from(orderItems)
      .where(and(inArray(orderItems.orderId, allOrderIds), isNull(orderItems.deletedAt)));

    const itemsByOrder = new Map<number, typeof allItems>();
    for (const item of allItems) {
      if (!itemsByOrder.has(item.orderId)) itemsByOrder.set(item.orderId, []);
      itemsByOrder.get(item.orderId)!.push(item);
    }

    // Orders with an error transaction on record (in addition to
    // order.status='error') count as "has an error in our system"
    const errorTxnRows = await db
      .select({ orderId: depTransactions.orderId })
      .from(depTransactions)
      .where(and(inArray(depTransactions.orderId, allOrderIds), eq(depTransactions.status, 'error')));
    const errorTxnOrderIds = new Set(errorTxnRows.map((r) => r.orderId));

    // Get DEP details for orders that have depOrderId
    const depOrderNumbers = dbOrders
      .map((o) => o.depOrderId || o.externalOrderId)
      .filter(Boolean) as string[];

    const depData: Record<string, any> = {};
    let depQueryOk = false;
    if (depCred && depOrderNumbers.length > 0) {
      try {
        const request = {
          requestContext: { shipTo: depCred.shipTo, timeZone: '420', langCode: 'en' },
          depResellerId: depCred.depResellerId,
          orderNumbers: depOrderNumbers,
        };
        const response = await this.callDep(depCred, '/enroll-service/1.0/show-order-details', request) as any;
        for (const depOrder of response.orders ?? []) {
          depData[depOrder.orderNumber] = depOrder;
        }
        depQueryOk = true;
      } catch (err) {
        this.logger.warn(`DEP reconciliation call failed: ${err}`);
      }
    }

    // Build comparison and apply status updates
    const comparisons = [];
    for (const order of dbOrders) {
      const ourItems = itemsByOrder.get(order.id) ?? [];
      const orderNum = order.depOrderId || order.externalOrderId || String(order.id);
      const depOrder = depData[orderNum];

      // DEP devices
      const depDevices: string[] = [];
      if (depOrder?.deliveries) {
        for (const del of depOrder.deliveries) {
          for (const dev of del.devices ?? []) {
            depDevices.push(dev.deviceId);
          }
        }
      }

      const ourSerials = ourItems.map((i) => i.serialNumber).sort();
      const depSerials = depDevices.sort();

      const inOursNotDep = ourSerials.filter((s) => !depSerials.includes(s));
      const inDepNotOurs = depSerials.filter((s) => !ourSerials.includes(s));

      const action = await this.applyReconcileAction(db, order, ourItems, depOrder ? depSerials : null, depQueryOk, errorTxnOrderIds);

      comparisons.push({
        orderId: order.id,
        orderNumber: orderNum,
        externalOrderId: order.externalOrderId,
        po: order.po,
        status: order.status,
        source: order.source,
        our: {
          deviceCount: ourSerials.length,
          devices: ourSerials,
          depOrderId: order.depOrderId,
          depOrderedAt: order.depOrderedAt,
        },
        dep: depOrder
          ? {
              deviceCount: depSerials.length,
              devices: depSerials,
              orderType: depOrder.orderType,
              orderDate: depOrder.orderDate,
              customerId: depOrder.customerId,
              status: depOrder.showOrderStatusCode || 'enrolled',
            }
          : null,
        differences: {
          inOursNotDep,
          inDepNotOurs,
          match: inOursNotDep.length === 0 && inDepNotOurs.length === 0 && depOrder != null,
        },
        action,
      });
    }

    return { comparisons };
  }

  /**
   * Apply the reconcile outcome for one order. Returns a summary of what
   * changed (shown in the reconcile dialog).
   */
  private async applyReconcileAction(
    db: TenantDb,
    order: typeof orders.$inferSelect,
    ourItems: (typeof orderItems.$inferSelect)[],
    depSerials: string[] | null,
    depQueryOk: boolean,
    errorTxnOrderIds: Set<number | null>,
  ): Promise<{ orderStatus: { from: string; to: string } | null; itemsMarkedComplete: number; reason: string }> {
    const action: { orderStatus: { from: string; to: string } | null; itemsMarkedComplete: number; reason: string } = {
      orderStatus: null,
      itemsMarkedComplete: 0,
      reason: '',
    };

    if (!depQueryOk) {
      action.reason = 'Apple query failed — no changes made';
      return action;
    }

    const depItems = ourItems.filter((i) => i.isDep);

    if (depSerials !== null) {
      // Order exists in Apple DEP — sync our statuses to match
      const enrolled = new Set(depSerials);
      const toComplete = depItems.filter((i) => enrolled.has(i.serialNumber) && i.depStatus !== 'complete');
      if (toComplete.length > 0) {
        await db.update(orderItems)
          .set({ depStatus: 'complete', updatedAt: new Date() })
          .where(and(
            eq(orderItems.orderId, order.id),
            inArray(orderItems.serialNumber, toComplete.map((i) => i.serialNumber)),
          ));
        action.itemsMarkedComplete = toComplete.length;
      }

      const enrolledCount = depItems.filter((i) => enrolled.has(i.serialNumber)).length;
      let newStatus = order.status;
      if (depItems.length > 0 && enrolledCount === depItems.length) {
        newStatus = 'complete';
      } else if (enrolledCount > 0) {
        newStatus = 'submitted';
      }

      if (newStatus !== order.status) {
        await db.update(orders)
          .set({ status: newStatus, updatedAt: new Date() })
          .where(eq(orders.id, order.id));
        action.orderStatus = { from: order.status, to: newStatus };
        action.reason = 'Updated to match Apple enrollment';
      } else {
        action.reason = action.itemsMarkedComplete > 0
          ? 'Device statuses synced from Apple'
          : 'Already in sync with Apple';
      }
      return action;
    }

    // Order not found in Apple DEP
    if (depItems.length === 0) {
      action.reason = 'No DEP devices — nothing to enroll';
    } else if (order.status === 'error' || errorTxnOrderIds.has(order.id)) {
      action.reason = 'Not in Apple, but has an error on our side — left for manual review';
    } else if (order.status === 'pending') {
      action.reason = 'Not found in Apple — already pending';
    } else {
      await db.update(orders)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(eq(orders.id, order.id));
      action.orderStatus = { from: order.status, to: 'pending' };
      action.reason = 'Not found in Apple — flagged pending for enrollment';
    }
    return action;
  }

  /**
   * Push the order's current state to the tenant's active ERP (NetSuite or
   * Zoho, per tenant metadata). Manual action from the order view — unlike
   * the pipeline write-backs this THROWS on failure so the user sees it.
   */
  async pushOrderStateToErp(tenant: TenantContext, orderId: number) {
    const db = tenant.db;

    const orderRows = await db.select().from(orders).where(eq(orders.id, orderId));
    if (orderRows.length === 0) throw new NotFoundException(`Order ${orderId} not found`);
    const order = orderRows[0];
    if (!order.externalOrderId) {
      throw new BadRequestException('Order has no external order ID — nothing to update in the ERP');
    }

    const items = await db
      .select()
      .from(orderItems)
      .where(and(eq(orderItems.orderId, orderId), isNull(orderItems.deletedAt)));
    const depItems = items.filter((i) => i.isDep);
    const enrolledCount = depItems.filter((i) => i.depStatus === 'complete').length;

    // Current state → the same dep_status/dep_response vocabulary the
    // pipeline write-backs use, with a device summary for in-flight states
    const depStatus = order.status.charAt(0).toUpperCase() + order.status.slice(1);
    let depResponse: string;
    if (order.status === 'complete') {
      depResponse = 'Complete';
    } else if (order.status === 'error') {
      depResponse = (await this.latestDepErrorMessage(db, orderId)) ?? 'There is a problem with this order';
    } else {
      depResponse = `${enrolledCount}/${depItems.length} DEP devices enrolled`;
    }

    const metadata = tenant.tenant.metadata ? JSON.parse(tenant.tenant.metadata) : {};
    const erp: 'netsuite' | 'zoho' = metadata.connectionType || 'netsuite';

    if (erp === 'zoho') {
      await this.pushDepStatusToZoho(db, order.externalOrderId, depResponse, depStatus);
    } else {
      const cred = await this.credentialsService.findNewestActiveByType(db, 'netsuite');
      if (!cred) throw new BadRequestException('No active NetSuite credentials configured');
      await this.netsuitePutDepStatus(db, cred.connectionData as Record<string, unknown>, order.externalOrderId, depResponse, depStatus);
    }

    this.logger.log(`Pushed order ${orderId} state '${depStatus}' to ${erp} (${order.externalOrderId})`);
    return { erp, orderId, externalOrderId: order.externalOrderId, depStatus, depResponse };
  }

  private async latestDepErrorMessage(db: TenantDb, orderId: number): Promise<string | null> {
    const rows = await db
      .select()
      .from(depTransactions)
      .where(eq(depTransactions.orderId, orderId))
      .orderBy(desc(depTransactions.id));
    return rows.find((t) => t.errorMessage)?.errorMessage ?? null;
  }

  /**
   * Push a DEP outcome back to the NetSuite order via the order RESTlet
   * (same contract as the legacy system: PUT { order_id, dep_response,
   * dep_status }). Best-effort — a NetSuite failure is logged, never thrown,
   * and tenants without NetSuite credentials are skipped.
   */
  private async pushDepStatusToNetsuite(
    db: TenantDb,
    externalOrderId: string | null | undefined,
    depResponse: string,
    depStatus: 'Complete' | 'Error',
  ): Promise<void> {
    if (!externalOrderId) return;

    try {
      const cred = await this.credentialsService.findNewestActiveByType(db, 'netsuite');
      if (!cred) return;
      await this.netsuitePutDepStatus(db, cred.connectionData as Record<string, unknown>, externalOrderId, depResponse, depStatus);
      this.logger.log(`Pushed DEP status '${depStatus}' to NetSuite for order ${externalOrderId}`);
    } catch (err) {
      this.logger.warn(`NetSuite DEP status push failed for order ${externalOrderId}: ${err}`);
    }
  }

  /** PUT { order_id, dep_response, dep_status } to the order RESTlet; throws on failure. */
  private async netsuitePutDepStatus(
    db: TenantDb,
    connectionData: Record<string, unknown>,
    externalOrderId: string,
    depResponse: string,
    depStatus: string,
  ): Promise<void> {
    const scriptId = connectionData['netsuite_order_script_id'] as string;
    if (!scriptId) throw new BadRequestException('NetSuite credentials are missing netsuite_order_script_id');

    const result = await this.netsuiteService.makeRequest(db, 'PUT', scriptId, {
      order_id: externalOrderId,
      dep_response: depResponse.slice(0, 1000),
      dep_status: depStatus,
    });
    if (!result.success) {
      throw new BadRequestException(`NetSuite update failed: ${result.error}`);
    }
  }

  /**
   * Update the Zoho CRM order record with the DEP state. Field API names
   * default to DEP_Status / DEP_Response and can be overridden via the
   * credential's zoho_dep_status_field / zoho_dep_response_field keys.
   */
  private async pushDepStatusToZoho(
    db: TenantDb,
    externalOrderId: string,
    depResponse: string,
    depStatus: string,
  ): Promise<void> {
    const cred = await this.credentialsService.findNewestActiveByType(db, 'zoho');
    if (!cred) throw new BadRequestException('No active Zoho credentials configured');
    const data = cred.connectionData as Record<string, unknown>;

    const apiDomain = (data['api_domain'] as string) || 'https://www.zohoapis.com';
    const ordersModule = (data['orders_module'] as string) || 'Sales_Orders';
    const statusField = (data['zoho_dep_status_field'] as string) || 'DEP_Status';
    const responseField = (data['zoho_dep_response_field'] as string) || 'DEP_Response';

    const token = await this.getZohoAccessToken(data);
    const resp = await fetch(`${apiDomain}/crm/v3/${ordersModule}/${externalOrderId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: [{ [statusField]: depStatus, [responseField]: depResponse.slice(0, 1000) }],
      }),
    });

    const body = (await resp.json().catch(() => null)) as { data?: { status?: string; message?: string }[] } | null;
    const recordResult = body?.data?.[0];
    if (!resp.ok || recordResult?.status === 'error') {
      throw new BadRequestException(`Zoho update failed: ${recordResult?.message || `HTTP ${resp.status}`}`);
    }
  }

  private async getZohoAccessToken(connectionData: Record<string, unknown>): Promise<string> {
    const resp = await fetch('https://accounts.zoho.com/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: connectionData['client_id'] as string,
        client_secret: connectionData['client_secret'] as string,
        refresh_token: connectionData['refresh_token'] as string,
      }).toString(),
    });
    const tok = (await resp.json()) as { access_token?: string; error?: string };
    if (!tok.access_token) {
      throw new BadRequestException(`Zoho token refresh failed: ${tok.error || 'unknown error'}`);
    }
    return tok.access_token;
  }

  // ---- Private helpers ----

  private async loadOrderAndCreds(db: TenantDb, orderId: number, customerId?: string) {
    const orderRows = await db.select().from(orders).where(eq(orders.id, orderId));
    if (orderRows.length === 0) throw new NotFoundException(`Order ${orderId} not found`);
    const order = orderRows[0];

    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));

    const cred = await this.getDepCredentials(db);
    if (!cred) throw new BadRequestException('No active DEP credentials configured');

    // Resolve customer ID: explicit > account's depAccountId (Apple ABM org ID).
    // Never fall back to sap_sold_to — Apple rejects it with DEP-ERR-OR-4102.
    let resolvedCustomerId = customerId;
    if (!resolvedCustomerId && order.accountId) {
      const acct = await db.select().from(accounts).where(eq(accounts.id, order.accountId)).limit(1);
      if (acct[0]?.depAccountId) resolvedCustomerId = acct[0].depAccountId;
    }
    if (!resolvedCustomerId) {
      throw new BadRequestException(
        `Order ${orderId} has no Apple org ID: its account is missing a DEP account ID. ` +
          `Sync accounts from NetSuite or pass customerId explicitly.`,
      );
    }

    return { order, items, cred, resolvedCustomerId };
  }

  private async getDepCredentials(db: TenantDb): Promise<DepCredentials | null> {
    const cred = await this.credentialsService.findNewestActiveByType(db, 'dep');
    if (!cred) return null;
    const data = cred.connectionData as Record<string, unknown>;
    return {
      apiUrl: data['apple_api_url'] as string,
      shipTo: data['sap_ship_to'] as string,
      depResellerId: data['dep_reseller_id'] as string,
      sslKey: data['ssl_key'] as string,
      sslCert: data['ssl_cert'] as string,
    };
  }

  private buildBulkEnrollRequest(cred: DepCredentials, txnId: string, depOrders: any[]) {
    return {
      requestContext: { shipTo: cred.shipTo, timeZone: '420', langCode: 'en' },
      transactionId: txnId,
      depResellerId: cred.depResellerId,
      orders: depOrders,
    };
  }

  private async callDep(cred: DepCredentials, path: string, body: unknown): Promise<unknown> {
    const url = new URL(path, cred.apiUrl);
    const payload = JSON.stringify(body);

    return new Promise((resolve, reject) => {
      const agent = new https.Agent({ key: cred.sslKey, cert: cred.sslCert, rejectUnauthorized: true });
      const req = https.request({
        hostname: url.hostname, port: url.port || 443, path: url.pathname,
        method: 'POST', agent, timeout: 30000,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch { reject(new Error('Invalid JSON from DEP')); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('DEP request timed out')); });
      req.write(payload);
      req.end();
    });
  }

  private async logTransaction(db: TenantDb, orderId: number, txnId: string, orderType: string, request: unknown, response: unknown) {
    const resp = response as any;

    let status: 'pending' | 'in_progress' | 'complete' | 'error' | 'posted_with_errors';
    if (resp.errorCode || resp.errorMessage) {
      status = 'error';
    } else if (orderType === 'SC') {
      status = 'complete';
    } else if (resp.deviceEnrollmentTransactionId) {
      status = 'in_progress';
    } else {
      status = 'error';
    }

    await db.insert(depTransactions).values({
      orderId,
      transactionId: txnId,
      deviceEnrollmentTransactionId: resp.deviceEnrollmentTransactionId || null,
      orderType: orderType as any,
      status,
      requestPayload: JSON.stringify(request),
      responsePayload: JSON.stringify(response),
      errorCode: resp.errorCode || null,
      errorMessage: resp.errorMessage || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Apple rejected the submission outright — the poll scheduler will never
    // see this transaction (no deviceEnrollmentTransactionId), so surface the
    // error on the NetSuite order now. SC is a read-only query, not a
    // submission; a failed query is not an order error.
    if (status === 'error' && orderType !== 'SC') {
      const rows = await db
        .select({ externalOrderId: orders.externalOrderId })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);
      await this.pushDepStatusToNetsuite(
        db,
        rows[0]?.externalOrderId,
        resp.errorMessage || resp.errorCode || 'Apple DEP rejected the submission',
        'Error',
      );
    }
  }

  private formatDate(d: Date): string {
    return d.toISOString().replace(/\.\d+Z$/, 'Z');
  }
}
