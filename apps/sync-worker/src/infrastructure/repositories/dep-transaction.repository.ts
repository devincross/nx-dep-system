import { Injectable } from "@nestjs/common";
import { eq, inArray } from 'drizzle-orm';
import { depTransactions, TenantDb } from '@org/database';

export interface CreateDepTransaction {
  orderId?: number;
  transactionId: string;
  deviceEnrollmentTransactionId?: string;
  orderType: 'OR' | 'RE' | 'VD' | 'OV';
  status: 'pending' | 'in_progress' | 'complete' | 'error' | 'posted_with_errors';
  requestPayload?: string;
  responsePayload?: string;
  errorCode?: string;
  errorMessage?: string;
}

@Injectable()
export class DepTransactionRepository {
  private db: TenantDb | null = null;

  setDb(db: TenantDb): void {
    this.db = db;
  }

  private ensureDb(): TenantDb {
    if (!this.db) throw new Error('Database not set. Call setDb() first.');
    return this.db;
  }

  async create(data: CreateDepTransaction) {
    const db = this.ensureDb();
    const now = new Date();

    const result = await db.insert(depTransactions).values({
      orderId: data.orderId,
      transactionId: data.transactionId,
      deviceEnrollmentTransactionId: data.deviceEnrollmentTransactionId,
      orderType: data.orderType,
      status: data.status,
      requestPayload: data.requestPayload,
      responsePayload: data.responsePayload,
      errorCode: data.errorCode,
      errorMessage: data.errorMessage,
      createdAt: now,
      updatedAt: now,
    });

    return Number(result[0].insertId);
  }

  async updateStatus(
    id: number,
    status: 'pending' | 'in_progress' | 'complete' | 'error' | 'posted_with_errors',
    opts?: {
      responsePayload?: string;
      errorCode?: string;
      errorMessage?: string;
      completedAt?: Date;
      deviceEnrollmentTransactionId?: string;
    },
  ) {
    const db = this.ensureDb();
    await db
      .update(depTransactions)
      .set({
        status,
        responsePayload: opts?.responsePayload,
        errorCode: opts?.errorCode,
        errorMessage: opts?.errorMessage,
        completedAt: opts?.completedAt,
        deviceEnrollmentTransactionId: opts?.deviceEnrollmentTransactionId,
        updatedAt: new Date(),
      })
      .where(eq(depTransactions.id, id));
  }

  /**
   * Find transactions that need status polling (pending or in_progress).
   */
  async findPendingTransactions() {
    const db = this.ensureDb();
    return db
      .select()
      .from(depTransactions)
      .where(
        inArray(depTransactions.status, ['pending', 'in_progress']),
      );
  }

  async findByTransactionId(transactionId: string) {
    const db = this.ensureDb();
    const results = await db
      .select()
      .from(depTransactions)
      .where(eq(depTransactions.transactionId, transactionId));
    return results[0] ?? null;
  }

  async findByDeviceEnrollmentTransactionId(deTxnId: string) {
    const db = this.ensureDb();
    const results = await db
      .select()
      .from(depTransactions)
      .where(eq(depTransactions.deviceEnrollmentTransactionId, deTxnId));
    return results[0] ?? null;
  }

  async findByOrderId(orderId: number) {
    const db = this.ensureDb();
    return db
      .select()
      .from(depTransactions)
      .where(eq(depTransactions.orderId, orderId));
  }
}
