import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { drizzle } from 'drizzle-orm/mysql2';
import * as mysql from 'mysql2/promise';
import { eq, and, inArray, isNull } from 'drizzle-orm';
import {
  getLandlordDb,
  tenants,
  domains,
  credentials,
  orders,
  orderItems,
  TenantDb,
} from '@org/database';
import { DepSyncAdapter, DepAdapterConfig } from '../infrastructure/adapters/dep/dep-sync.adapter.js';
import { NetsuiteAdapter } from '../infrastructure/adapters/netsuite/netsuite.adapter.js';
import { DepTransactionRepository } from '../infrastructure/repositories/dep-transaction.repository.js';
import { parseConnectionData } from '../infrastructure/credential-decrypt.util.js';

@Injectable()
export class DepPollScheduler {
  private readonly logger = new Logger(DepPollScheduler.name);

  /**
   * Poll Apple DEP for pending transaction statuses every 5 minutes.
   *
   * Each tenant's poll short-circuits to a single DB query when there are
   * no pending/in_progress transactions — no Apple API call. So 5-minute
   * cadence is cheap when idle and gives ~5min average latency after an
   * enroll.
   */
  @Cron('0 */5 * * * *')
  async handlePoll() {
    this.logger.debug('DEP poll tick');

    try {
      const landlordDb = getLandlordDb();

      // Get all active tenants with their domain info
      const tenantRows = await landlordDb
        .select({
          tenantId: tenants.id,
          slug: tenants.slug,
          dbHost: domains.dbHost,
          dbPort: domains.dbPort,
          dbName: domains.dbName,
          dbUser: domains.dbUser,
          dbPassword: domains.dbPassword,
          isPrimary: domains.isPrimary,
        })
        .from(tenants)
        .innerJoin(domains, eq(tenants.id, domains.tenantId))
        .where(eq(tenants.isActive, true));

      // Dedupe by tenant (pick primary domain)
      const tenantMap = new Map<string, typeof tenantRows[0]>();
      for (const row of tenantRows) {
        if (!tenantMap.has(row.tenantId) || row.isPrimary) {
          tenantMap.set(row.tenantId, row);
        }
      }

      let polledAny = false;
      for (const [, tenant] of tenantMap) {
        try {
          const polled = await this.pollTenant(tenant);
          if (polled) polledAny = true;
        } catch (error) {
          this.logger.error(`Failed to poll DEP for tenant ${tenant.slug}: ${error}`);
        }
      }

      if (polledAny) this.logger.log('DEP polling complete');
    } catch (error) {
      this.logger.error(`DEP polling failed: ${error}`);
    }
  }

  /**
   * Returns true if Apple was actually called for this tenant.
   */
  private async pollTenant(tenant: {
    slug: string;
    dbHost: string;
    dbPort: number;
    dbName: string;
    dbUser: string;
    dbPassword: string;
  }): Promise<boolean> {
    const connection = await mysql.createConnection({
      host: tenant.dbHost,
      port: tenant.dbPort,
      user: tenant.dbUser,
      password: tenant.dbPassword,
      database: tenant.dbName,
    });

    try {
      const tenantDb = drizzle(connection) as unknown as TenantDb;

      // Fresh adapter + repository per run — shared singletons race with
      // the other schedulers (see DepPushScheduler)
      const depAdapter = new DepSyncAdapter();
      const depTransactionRepo = new DepTransactionRepository();
      depTransactionRepo.setDb(tenantDb);

      // Find pending transactions — short-circuit before any Apple call
      const pendingTxns = await depTransactionRepo.findPendingTransactions();
      if (pendingTxns.length === 0) return false;

      this.logger.log(`Found ${pendingTxns.length} pending DEP transactions for ${tenant.slug}`);

      // Get DEP credentials for this tenant
      const depCred = await this.getDepCredentials(tenantDb);
      if (!depCred) {
        this.logger.warn(`No DEP credentials for tenant ${tenant.slug}`);
        return false;
      }

      depAdapter.configure(depCred);

      // NetSuite adapter for pushing DEP outcomes back to the source
      // system — null for tenants without NetSuite credentials
      const netsuiteAdapter = await this.getNetsuiteAdapter(tenantDb);

      for (const txn of pendingTxns) {
        if (!txn.deviceEnrollmentTransactionId) continue;

        try {
          const { response } = await depAdapter.checkTransactionStatus(
            txn.deviceEnrollmentTransactionId,
          );

          const responseJson = JSON.stringify(response);

          if (response.statusCode === 'COMPLETE') {
            await depTransactionRepo.updateStatus(txn.id, 'complete', {
              responsePayload: responseJson,
              completedAt: response.completedOn ? new Date(response.completedOn) : new Date(),
            });
            await this.applyOutcomeToOrder(tenantDb, txn, 'complete', response);
            await this.pushOutcomeToNetsuite(tenantDb, netsuiteAdapter, txn, 'complete');
            this.logger.log(`DEP transaction ${txn.transactionId} completed`);
          } else if ((response as any).statusCode === 'COMPLETE_WITH_ERRORS') {
            const errorMsg = this.extractErrors(response);
            await depTransactionRepo.updateStatus(txn.id, 'posted_with_errors', {
              responsePayload: responseJson,
              errorMessage: errorMsg,
              completedAt: response.completedOn ? new Date(response.completedOn) : new Date(),
            });
            await this.applyOutcomeToOrder(tenantDb, txn, 'posted_with_errors', response);
            await this.pushOutcomeToNetsuite(tenantDb, netsuiteAdapter, txn, 'error', errorMsg);
            this.logger.warn(`DEP transaction ${txn.transactionId} posted with errors: ${errorMsg}`);
          } else if (response.statusCode === 'ERROR') {
            const errorMsg = this.extractErrors(response);
            await depTransactionRepo.updateStatus(txn.id, 'error', {
              responsePayload: responseJson,
              errorMessage: errorMsg,
              completedAt: response.completedOn ? new Date(response.completedOn) : new Date(),
            });
            await this.applyOutcomeToOrder(tenantDb, txn, 'error', response);
            await this.pushOutcomeToNetsuite(tenantDb, netsuiteAdapter, txn, 'error', errorMsg);
            this.logger.warn(`DEP transaction ${txn.transactionId} errored: ${errorMsg}`);
          } else if (response.checkTransactionErrorResponse) {
            const errors = response.checkTransactionErrorResponse;
            const inProgress = errors.some((e) => e.errorCode === 'DEP-ERR-4003');

            if (inProgress) {
              await depTransactionRepo.updateStatus(txn.id, 'in_progress', {
                responsePayload: responseJson,
              });
            } else {
              const errorMsg = errors.map((e) => `${e.errorCode}: ${e.errorMessage}`).join('; ');
              await depTransactionRepo.updateStatus(txn.id, 'error', {
                responsePayload: responseJson,
                errorCode: errors[0].errorCode,
                errorMessage: errorMsg,
              });
              await this.applyOutcomeToOrder(tenantDb, txn, 'error', response);
              await this.pushOutcomeToNetsuite(tenantDb, netsuiteAdapter, txn, 'error', errorMsg);
            }
          }
          // else: still in progress, leave as-is
        } catch (error) {
          this.logger.error(
            `Failed to check status for txn ${txn.transactionId}: ${error}`,
          );
        }
      }
      return true;
    } finally {
      await connection.end();
    }
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
  private async applyOutcomeToOrder(
    db: TenantDb,
    txn: { orderId: number | null; orderType: string; requestPayload: string | null },
    status: 'complete' | 'error' | 'posted_with_errors',
    response: any,
  ): Promise<void> {
    const orderId = txn.orderId;
    if (!orderId) return;

    if (status === 'error') {
      await db.update(orders)
        .set({ status: 'error', updatedAt: new Date() })
        .where(eq(orders.id, orderId));

      const failingSerials = this.extractDeviceIds(response, 'failing');
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

    // Enrollment transactions mark their devices complete; returns/voids don't
    if (txn.orderType === 'OR' || txn.orderType === 'OV') {
      let completedSerials = this.extractDeviceIds(response, 'completed');
      if (completedSerials.length === 0 && status === 'complete') {
        // Apple sometimes returns no device detail — fall back to the
        // devices we submitted in the original request
        completedSerials = this.deviceIdsFromRequestPayload(txn.requestPayload);
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
      const failingSerials = this.extractDeviceIds(response, 'failing');
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
    if (txn.orderType === 'OR' || txn.orderType === 'OV') {
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

  /**
   * Push a resolved DEP outcome back to the NetSuite order (same RESTlet
   * contract as the legacy system: PUT { order_id, dep_response, dep_status }).
   * Best-effort — a NetSuite failure is logged but never blocks the poll.
   */
  private async pushOutcomeToNetsuite(
    db: TenantDb,
    netsuite: NetsuiteAdapter | null,
    txn: { orderId: number | null; orderType: string; transactionId: string },
    outcome: 'complete' | 'error',
    errorMessage?: string,
  ): Promise<void> {
    if (!netsuite || !txn.orderId) return;

    const rows = await db
      .select({ externalOrderId: orders.externalOrderId })
      .from(orders)
      .where(eq(orders.id, txn.orderId))
      .limit(1);
    const externalOrderId = rows[0]?.externalOrderId;
    if (!externalOrderId) return;

    let depResponse: string;
    let depStatus: string;
    if (outcome === 'complete') {
      depStatus = 'Complete';
      depResponse = txn.orderType === 'RE' ? 'Return Complete'
        : txn.orderType === 'VD' ? 'Void Complete'
        : 'Complete';
    } else {
      depStatus = 'Error';
      depResponse = (errorMessage || 'There is a problem with this order').slice(0, 1000);
    }

    try {
      await netsuite.updateOrderDepStatus(externalOrderId, depResponse, depStatus);
      this.logger.log(
        `Pushed DEP status '${depStatus}' to NetSuite for order ${externalOrderId} (txn ${txn.transactionId})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to push DEP status to NetSuite for order ${externalOrderId}: ${error}`,
      );
    }
  }

  /**
   * Per-run NetSuite adapter from the tenant's credentials, or null when
   * the tenant isn't NetSuite-backed.
   */
  private async getNetsuiteAdapter(db: TenantDb): Promise<NetsuiteAdapter | null> {
    const results = await db
      .select()
      .from(credentials)
      .where(and(eq(credentials.type, 'netsuite'), eq(credentials.status, 'current')))
      .limit(1);

    if (results.length === 0) return null;

    try {
      return NetsuiteAdapter.fromConnectionData(parseConnectionData(results[0].connectionData));
    } catch (error) {
      this.logger.error(`Failed to parse NetSuite credentials: ${error}`);
      return null;
    }
  }

  private extractDeviceIds(response: any, which: 'completed' | 'failing'): string[] {
    const serials: string[] = [];
    for (const order of response.orders ?? []) {
      for (const delivery of order.deliveries ?? []) {
        for (const device of delivery.devices ?? []) {
          if (!device.deviceId || !device.devicePostStatus) continue;
          const isComplete = device.devicePostStatus === 'COMPLETE';
          if ((which === 'completed') === isComplete) {
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

  private extractErrors(response: any): string {
    const messages: string[] = [];
    for (const order of response.orders ?? []) {
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
    return messages.join('; ') || 'Unknown error';
  }

  private async getDepCredentials(db: TenantDb): Promise<DepAdapterConfig | null> {
    const results = await db
      .select()
      .from(credentials)
      .where(and(eq(credentials.type, 'dep'), eq(credentials.status, 'current')))
      .limit(1);

    if (results.length === 0) return null;

    let data: Record<string, unknown>;
    try {
      data = parseConnectionData(results[0].connectionData);
    } catch (error) {
      this.logger.error(`Failed to parse DEP credentials: ${error}`);
      return null;
    }

    return {
      apiUrl: data['apple_api_url'] as string,
      shipTo: data['sap_ship_to'] as string,
      depResellerId: data['dep_reseller_id'] as string,
      sslKey: data['ssl_key'] as string,
      sslCert: data['ssl_cert'] as string,
    };
  }
}
