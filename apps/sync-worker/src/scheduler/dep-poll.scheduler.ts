import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { drizzle } from 'drizzle-orm/mysql2';
import * as mysql from 'mysql2/promise';
import { eq, and } from 'drizzle-orm';
import {
  getLandlordDb,
  tenants,
  domains,
  credentials,
  TenantDb,
} from '@org/database';
import { DepSyncAdapter, DepAdapterConfig } from '../infrastructure/adapters/dep/dep-sync.adapter.js';
import { DepTransactionRepository } from '../infrastructure/repositories/dep-transaction.repository.js';

@Injectable()
export class DepPollScheduler {
  private readonly logger = new Logger(DepPollScheduler.name);

  constructor(
    private readonly depAdapter: DepSyncAdapter,
    private readonly depTransactionRepo: DepTransactionRepository,
  ) {}

  /**
   * Poll Apple DEP for pending transaction statuses every hour.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handlePoll() {
    this.logger.log('Polling DEP transaction statuses...');

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

      for (const [, tenant] of tenantMap) {
        try {
          await this.pollTenant(tenant);
        } catch (error) {
          this.logger.error(`Failed to poll DEP for tenant ${tenant.slug}: ${error}`);
        }
      }

      this.logger.log('DEP polling complete');
    } catch (error) {
      this.logger.error(`DEP polling failed: ${error}`);
    }
  }

  private async pollTenant(tenant: {
    slug: string;
    dbHost: string;
    dbPort: number;
    dbName: string;
    dbUser: string;
    dbPassword: string;
  }) {
    const connection = await mysql.createConnection({
      host: tenant.dbHost,
      port: tenant.dbPort,
      user: tenant.dbUser,
      password: tenant.dbPassword,
      database: tenant.dbName,
    });

    try {
      const tenantDb = drizzle(connection) as unknown as TenantDb;
      this.depTransactionRepo.setDb(tenantDb);

      // Find pending transactions
      const pendingTxns = await this.depTransactionRepo.findPendingTransactions();
      if (pendingTxns.length === 0) return;

      this.logger.log(`Found ${pendingTxns.length} pending DEP transactions for ${tenant.slug}`);

      // Get DEP credentials for this tenant
      const depCred = await this.getDepCredentials(tenantDb);
      if (!depCred) {
        this.logger.warn(`No DEP credentials for tenant ${tenant.slug}`);
        return;
      }

      this.depAdapter.configure(depCred);

      for (const txn of pendingTxns) {
        if (!txn.deviceEnrollmentTransactionId) continue;

        try {
          const { response } = await this.depAdapter.checkTransactionStatus(
            txn.deviceEnrollmentTransactionId,
          );

          const responseJson = JSON.stringify(response);

          if (response.statusCode === 'COMPLETE') {
            await this.depTransactionRepo.updateStatus(txn.id, 'complete', {
              responsePayload: responseJson,
              completedAt: response.completedOn ? new Date(response.completedOn) : new Date(),
            });
            this.logger.log(`DEP transaction ${txn.transactionId} completed`);
          } else if (response.statusCode === 'ERROR') {
            const errorMsg = this.extractErrors(response);
            await this.depTransactionRepo.updateStatus(txn.id, 'error', {
              responsePayload: responseJson,
              errorMessage: errorMsg,
              completedAt: response.completedOn ? new Date(response.completedOn) : new Date(),
            });
            this.logger.warn(`DEP transaction ${txn.transactionId} errored: ${errorMsg}`);
          } else if (response.checkTransactionErrorResponse) {
            const errors = response.checkTransactionErrorResponse;
            const inProgress = errors.some((e) => e.errorCode === 'DEP-ERR-4003');

            if (inProgress) {
              await this.depTransactionRepo.updateStatus(txn.id, 'in_progress', {
                responsePayload: responseJson,
              });
            } else {
              const errorMsg = errors.map((e) => `${e.errorCode}: ${e.errorMessage}`).join('; ');
              await this.depTransactionRepo.updateStatus(txn.id, 'error', {
                responsePayload: responseJson,
                errorCode: errors[0].errorCode,
                errorMessage: errorMsg,
              });
            }
          }
          // else: still in progress, leave as-is
        } catch (error) {
          this.logger.error(
            `Failed to check status for txn ${txn.transactionId}: ${error}`,
          );
        }
      }
    } finally {
      await connection.end();
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

    // Note: connectionData is encrypted — in real use, decrypt via CredentialsService
    // For the sync-worker, we parse it directly (assuming it's been decrypted or stored plain)
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(results[0].connectionData) as Record<string, unknown>;
    } catch {
      this.logger.error('Failed to parse DEP credentials');
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
