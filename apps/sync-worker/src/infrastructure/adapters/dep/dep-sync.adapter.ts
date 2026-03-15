import { Injectable, Logger } from '@nestjs/common';
import * as https from 'https';
import {
  DepPayloadBuilder,
  BulkEnrollRequest,
  CheckTransactionStatusRequest,
  ShowOrderDetailsRequest,
  DepConfig,
  OrderEnrollmentData,
} from './dep-payload-builder.js';

// ---- Response types ----

export interface BulkEnrollResponse {
  deviceEnrollmentTransactionId?: string;
  enrollDevicesResponse?: {
    statusCode: string;
    statusMessage: string;
  };
  enrollDeviceErrorResponse?: DepError | DepError[];
  errorCode?: string;
  errorMessage?: string;
  transactionId?: string;
}

export interface CheckStatusResponse {
  deviceEnrollmentTransactionID?: string;
  transactionId?: string;
  completedOn?: string;
  statusCode?: string;
  orders?: CheckStatusOrder[];
  checkTransactionErrorResponse?: DepError[];
  errorCode?: string;
  errorMessage?: string;
}

export interface CheckStatusOrder {
  orderNumber: string;
  orderPostStatus: string;
  deliveries?: CheckStatusDelivery[];
}

export interface CheckStatusDelivery {
  deliveryNumber: string;
  deliveryPostStatus: string;
  devices?: CheckStatusDevice[];
}

export interface CheckStatusDevice {
  deviceId: string;
  devicePostStatus: string;
  devicePostStatusMessage?: string;
}

export interface ShowOrderDetailsResponse {
  statusCode?: string;
  respondedOn?: string;
  orders?: ShowOrderDetailsOrder[];
  showOrderErrorResponse?: DepError[];
  errorCode?: string;
  errorMessage?: string;
}

export interface ShowOrderDetailsOrder {
  orderNumber: string;
  orderDate?: string;
  orderType?: string;
  customerId?: string;
  poNumber?: string;
  showOrderStatusCode?: string;
  showOrderStatusMessage?: string;
  deliveries?: {
    deliveryNumber: string;
    shipDate: string;
    devices: { deviceId: string; assetTag?: string }[];
  }[];
}

export interface DepError {
  errorCode: string;
  errorMessage: string;
}

export interface DepAdapterConfig extends DepConfig {
  /** PEM-encoded SSL private key for mTLS */
  sslKey: string;
  /** PEM-encoded SSL certificate for mTLS */
  sslCert: string;
}

@Injectable()
export class DepSyncAdapter {
  private readonly logger = new Logger(DepSyncAdapter.name);
  private config: DepAdapterConfig | null = null;
  private payloadBuilder: DepPayloadBuilder | null = null;

  configure(config: DepAdapterConfig): void {
    this.config = config;
    this.payloadBuilder = new DepPayloadBuilder(config);
    this.logger.log(`DEP adapter configured for ${config.apiUrl}`);
  }

  /**
   * Post a Bulk Enroll Devices request to Apple DEP.
   */
  async bulkEnrollDevices(
    transactionId: string,
    orders: OrderEnrollmentData[],
  ): Promise<{ request: BulkEnrollRequest; response: BulkEnrollResponse }> {
    this.ensureConfigured();
    const request = this.payloadBuilder!.buildBulkEnrollRequest(transactionId, orders);
    const response = await this.post<BulkEnrollResponse>(
      '/enroll-service/1.0/bulk-enroll-devices',
      request,
    );
    return { request, response };
  }

  /**
   * Check the status of a previously submitted transaction.
   */
  async checkTransactionStatus(
    deviceEnrollmentTransactionId: string,
  ): Promise<{ request: CheckTransactionStatusRequest; response: CheckStatusResponse }> {
    this.ensureConfigured();
    const request = this.payloadBuilder!.buildCheckStatusRequest(deviceEnrollmentTransactionId);
    const response = await this.post<CheckStatusResponse>(
      '/enroll-service/1.0/check-transaction-status',
      request,
    );
    return { request, response };
  }

  /**
   * Get current enrollment details for order numbers.
   */
  async showOrderDetails(
    orderNumbers: string[],
  ): Promise<{ request: ShowOrderDetailsRequest; response: ShowOrderDetailsResponse }> {
    this.ensureConfigured();
    const request = this.payloadBuilder!.buildShowOrderDetailsRequest(orderNumbers);
    const response = await this.post<ShowOrderDetailsResponse>(
      '/enroll-service/1.0/show-order-details',
      request,
    );
    return { request, response };
  }

  /**
   * Test the connection by attempting to check status for a dummy transaction.
   */
  async testConnection(): Promise<boolean> {
    try {
      this.ensureConfigured();
      // Use show-order-details with an empty array — should get a structured error, not a connection error
      await this.post('/enroll-service/1.0/show-order-details', {
        requestContext: {
          shipTo: this.config!.shipTo,
          timeZone: '420',
          langCode: 'en',
        },
        depResellerId: this.config!.depResellerId,
        orderNumbers: ['CONNECTION_TEST'],
      });
      return true;
    } catch (error: any) {
      // DEP errors (like GRX codes) mean the connection works but the request is invalid — that's fine
      if (error?.depError) return true;
      this.logger.error(`DEP connection test failed: ${error?.message}`);
      return false;
    }
  }

  // ---- Private methods ----

  private async post<T>(path: string, body: unknown): Promise<T> {
    this.ensureConfigured();

    const url = new URL(path, this.config!.apiUrl);
    const payload = JSON.stringify(body);

    return new Promise<T>((resolve, reject) => {
      const agent = new https.Agent({
        key: this.config!.sslKey,
        cert: this.config!.sslCert,
        rejectUnauthorized: true,
      });

      const options: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        agent,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 30000,
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const responseBody = Buffer.concat(chunks).toString('utf-8');
          try {
            const parsed = JSON.parse(responseBody) as T;
            resolve(parsed);
          } catch {
            reject(new Error(`Invalid JSON response from DEP: ${responseBody.substring(0, 200)}`));
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('DEP API request timed out'));
      });

      req.write(payload);
      req.end();
    });
  }

  private ensureConfigured(): void {
    if (!this.config || !this.payloadBuilder) {
      throw new Error('DEP adapter not configured. Call configure() first.');
    }
  }
}
