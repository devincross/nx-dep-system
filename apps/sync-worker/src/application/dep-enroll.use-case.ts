import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { depTransactions } from '@org/database';
import { DepSyncAdapter, BulkEnrollResponse } from '../infrastructure/adapters/dep/dep-sync.adapter.js';
import { DepTransactionRepository } from '../infrastructure/repositories/dep-transaction.repository.js';
import { OrderEnrollmentData, DepOrderType } from '../infrastructure/adapters/dep/dep-payload-builder.js';

export interface EnrollOrderInput {
  /** Internal order DB id */
  orderId: number;
  /** Order number visible to Apple */
  orderNumber: string;
  /** UTC date string */
  orderDate: string;
  /** Apple org ID for the customer */
  customerId: string;
  /** Purchase order number */
  poNumber?: string;
  /** Ship date UTC */
  shipDate: string;
  /** Delivery number */
  deliveryNumber: string;
  /** Devices to enroll */
  devices: { serialNumber: string; assetTag?: string }[];
}

export interface DepEnrollResult {
  transactionId: string;
  deviceEnrollmentTransactionId?: string;
  success: boolean;
  error?: string;
  dbTransactionId: number;
}

@Injectable()
export class DepEnrollUseCase {
  private readonly logger = new Logger(DepEnrollUseCase.name);

  /**
   * Enroll devices (OR) into Apple DEP.
   */
  async enrollOrder(
    adapter: DepSyncAdapter,
    txnRepo: DepTransactionRepository,
    input: EnrollOrderInput,
  ): Promise<DepEnrollResult> {
    return this.submitOrder(adapter, txnRepo, 'OR', input);
  }

  /**
   * Return devices (RE) from Apple DEP.
   */
  async returnDevices(
    adapter: DepSyncAdapter,
    txnRepo: DepTransactionRepository,
    input: EnrollOrderInput,
  ): Promise<DepEnrollResult> {
    return this.submitOrder(adapter, txnRepo, 'RE', input);
  }

  /**
   * Override an order (OV) in Apple DEP.
   */
  async overrideOrder(
    adapter: DepSyncAdapter,
    txnRepo: DepTransactionRepository,
    input: EnrollOrderInput,
  ): Promise<DepEnrollResult> {
    return this.submitOrder(adapter, txnRepo, 'OV', input);
  }

  /**
   * Void an order (VD) in Apple DEP.
   */
  async voidOrder(
    adapter: DepSyncAdapter,
    txnRepo: DepTransactionRepository,
    orderId: number,
    orderNumber: string,
    orderDate: string,
    customerId: string,
    poNumber?: string,
  ): Promise<DepEnrollResult> {
    const transactionId = uuidv4().replace(/-/g, "").slice(0, 20);

    // Record the transaction before sending
    const dbTxnId = await txnRepo.create({
      orderId,
      transactionId,
      orderType: 'VD',
      status: 'pending',
    });

    try {
      const { request, response } = await adapter.bulkEnrollDevices(transactionId, [
        {
          orderNumber,
          orderDate,
          orderType: 'VD',
          customerId,
          poNumber,
          deliveries: [],
        },
      ]);

      // Log request/response
      await txnRepo.updateStatus(dbTxnId, 'pending', {
        responsePayload: JSON.stringify(response),
        deviceEnrollmentTransactionId: response.deviceEnrollmentTransactionId,
      });

      // Update the stored request payload
      await this.updateRequestPayload(txnRepo, dbTxnId, request);

      return this.processResponse(txnRepo, dbTxnId, transactionId, response);
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await txnRepo.updateStatus(dbTxnId, 'error', {
        errorMessage: errorMsg,
      });
      return { transactionId, success: false, error: errorMsg, dbTransactionId: dbTxnId };
    }
  }

  // ---- Private ----

  private async submitOrder(
    adapter: DepSyncAdapter,
    txnRepo: DepTransactionRepository,
    orderType: DepOrderType,
    input: EnrollOrderInput,
  ): Promise<DepEnrollResult> {
    const transactionId = uuidv4().replace(/-/g, "").slice(0, 20);

    const enrollmentData: OrderEnrollmentData = {
      orderNumber: input.orderNumber,
      orderDate: input.orderDate,
      orderType,
      customerId: input.customerId,
      poNumber: input.poNumber,
      deliveries: [
        {
          deliveryNumber: input.deliveryNumber,
          shipDate: input.shipDate,
          devices: input.devices,
        },
      ],
    };

    // Record the transaction before sending
    const dbTxnId = await txnRepo.create({
      orderId: input.orderId,
      transactionId,
      orderType,
      status: 'pending',
    });

    try {
      const { request, response } = await adapter.bulkEnrollDevices(transactionId, [enrollmentData]);

      await this.updateRequestPayload(txnRepo, dbTxnId, request);
      await txnRepo.updateStatus(dbTxnId, 'pending', {
        responsePayload: JSON.stringify(response),
        deviceEnrollmentTransactionId: response.deviceEnrollmentTransactionId,
      });

      return this.processResponse(txnRepo, dbTxnId, transactionId, response);
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await txnRepo.updateStatus(dbTxnId, 'error', {
        errorMessage: errorMsg,
      });
      return { transactionId, success: false, error: errorMsg, dbTransactionId: dbTxnId };
    }
  }

  private processResponse(
    txnRepo: DepTransactionRepository,
    dbTxnId: number,
    transactionId: string,
    response: BulkEnrollResponse,
  ): DepEnrollResult {
    // Check for top-level errors
    if (response.errorCode) {
      txnRepo.updateStatus(dbTxnId, 'error', {
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
        completedAt: new Date(),
      });
      return {
        transactionId,
        success: false,
        error: `${response.errorCode}: ${response.errorMessage}`,
        dbTransactionId: dbTxnId,
      };
    }

    // Check for enroll error response
    if (response.enrollDeviceErrorResponse) {
      const errors = Array.isArray(response.enrollDeviceErrorResponse)
        ? response.enrollDeviceErrorResponse
        : [response.enrollDeviceErrorResponse];
      const errorMsg = errors.map((e) => `${e.errorCode}: ${e.errorMessage}`).join('; ');

      txnRepo.updateStatus(dbTxnId, 'error', {
        errorCode: errors[0].errorCode,
        errorMessage: errorMsg,
        completedAt: new Date(),
      });
      return {
        transactionId,
        success: false,
        error: errorMsg,
        dbTransactionId: dbTxnId,
      };
    }

    // Success — transaction accepted, need to poll for completion
    if (response.enrollDevicesResponse?.statusCode === 'SUCCESS') {
      txnRepo.updateStatus(dbTxnId, 'in_progress', {
        deviceEnrollmentTransactionId: response.deviceEnrollmentTransactionId,
      });

      this.logger.log(
        `DEP transaction submitted: ${transactionId} → ${response.deviceEnrollmentTransactionId}`,
      );

      return {
        transactionId,
        deviceEnrollmentTransactionId: response.deviceEnrollmentTransactionId,
        success: true,
        dbTransactionId: dbTxnId,
      };
    }

    // Unknown response
    return {
      transactionId,
      success: false,
      error: `Unexpected response: ${JSON.stringify(response)}`,
      dbTransactionId: dbTxnId,
    };
  }

  private async updateRequestPayload(
    txnRepo: DepTransactionRepository,
    dbTxnId: number,
    request: unknown,
  ): Promise<void> {
    // We need to update just the request payload — use a direct status update
    const db = (txnRepo as unknown as { db?: unknown }).db as
      | { update: (table: unknown) => { set: (data: unknown) => { where: (cond: unknown) => Promise<unknown> } } }
      | undefined;
    if (db) {
      await db
        .update(depTransactions)
        .set({ requestPayload: JSON.stringify(request) })
        .where(eq(depTransactions.id, dbTxnId));
    }
  }
}
