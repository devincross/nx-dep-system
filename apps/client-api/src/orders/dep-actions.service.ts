import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and, inArray, isNull } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import * as https from 'https';
import {
  TenantDb,
  orders,
  orderItems,
  accounts,
  credentials,
  depTransactions,
} from '@org/database';
import { CredentialsService } from '../credentials/credentials.service.js';
import type { TenantContext } from '../tenant/tenant-context.service.js';

interface DepCredentials {
  apiUrl: string;
  shipTo: string;
  depResellerId: string;
  sslKey: string;
  sslCert: string;
  soldTo: string;
}

@Injectable()
export class DepActionsService {
  private readonly logger = new Logger(DepActionsService.name);

  constructor(private readonly credentialsService: CredentialsService) {}

  async enrollOrder(db: TenantDb, orderId: number, customerId?: string) {
    const { order, items, cred, resolvedCustomerId } = await this.loadOrderAndCreds(db, orderId, customerId);
    const depItems = items.filter((i) => i.isDep && !i.deletedAt);
    if (depItems.length === 0) throw new BadRequestException('No DEP-eligible devices on this order');

    const txnId = `TXN_${uuidv4()}`;
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
    return { transactionId: txnId, response };
  }

  async returnDevices(db: TenantDb, orderId: number, serialNumbers?: string[]) {
    const { order, items, cred, resolvedCustomerId } = await this.loadOrderAndCreds(db, orderId);
    const depItems = serialNumbers?.length
      ? items.filter((i) => serialNumbers.includes(i.serialNumber))
      : items.filter((i) => i.isDep && !i.deletedAt);
    if (depItems.length === 0) throw new BadRequestException('No devices to return');

    const txnId = `TXN_${uuidv4()}`;
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
    const txnId = `TXN_${uuidv4()}`;
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

    const txnId = `TXN_${uuidv4()}`;
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
    return { orderNumber, request, response };
  }

  /**
   * Reconcile: compare our DB, Apple DEP, and ERP data side by side
   */
  async reconcileOrders(tenant: TenantContext, orderIds?: number[]) {
    const db = tenant.db;
    const metadata = tenant.tenant.metadata ? JSON.parse(tenant.tenant.metadata) : {};
    const connectionType: 'netsuite' | 'zoho' = metadata.connectionType || 'netsuite';

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

    // Get DEP details for orders that have depOrderId
    const depOrderNumbers = dbOrders
      .map((o) => o.depOrderId || o.externalOrderId)
      .filter(Boolean) as string[];

    let depData: Record<string, any> = {};
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
      } catch (err) {
        this.logger.warn(`DEP reconciliation call failed: ${err}`);
      }
    }

    // Build comparison
    const comparisons = dbOrders.map((order) => {
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

      return {
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
      };
    });

    return { comparisons };
  }

  // ---- Private helpers ----

  private async loadOrderAndCreds(db: TenantDb, orderId: number, customerId?: string) {
    const orderRows = await db.select().from(orders).where(eq(orders.id, orderId));
    if (orderRows.length === 0) throw new NotFoundException(`Order ${orderId} not found`);
    const order = orderRows[0];

    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));

    const cred = await this.getDepCredentials(db);
    if (!cred) throw new BadRequestException('No active DEP credentials configured');

    // Resolve customer ID: explicit > account's depAccountId > soldTo
    let resolvedCustomerId = customerId || cred.soldTo;
    if (!customerId && order.accountId) {
      const acct = await db.select().from(accounts).where(eq(accounts.id, order.accountId)).limit(1);
      if (acct[0]?.depAccountId) resolvedCustomerId = acct[0].depAccountId;
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
      soldTo: data['sap_sold_to'] as string,
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
    await db.insert(depTransactions).values({
      orderId,
      transactionId: txnId,
      deviceEnrollmentTransactionId: resp.deviceEnrollmentTransactionId || null,
      orderType: orderType as any,
      status: resp.deviceEnrollmentTransactionId ? 'in_progress' : 'error',
      requestPayload: JSON.stringify(request),
      responsePayload: JSON.stringify(response),
      errorCode: resp.errorCode || null,
      errorMessage: resp.errorMessage || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  private formatDate(d: Date): string {
    return d.toISOString().replace(/\.\d+Z$/, 'Z');
  }
}
