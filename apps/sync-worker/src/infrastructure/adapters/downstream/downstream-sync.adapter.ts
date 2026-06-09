import { Injectable, Logger } from '@nestjs/common';
import {
  DownstreamSyncPort,
  OrderChangePayload,
  PushBatchResult,
  PushOrderChangesResult,
} from '../../../domain/ports/downstream-sync.port.js';

export interface DownstreamConfig {
  /** Base URL for the downstream API */
  baseUrl: string;
  
  /** API key or token for authentication */
  apiKey?: string;
  
  /** Additional headers to include */
  headers?: Record<string, string>;
  
  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * Base adapter for pushing changes to a downstream system.
 * Extend this class and override the methods to implement your specific API.
 */
@Injectable()
export class DownstreamSyncAdapter implements DownstreamSyncPort {
  private readonly logger = new Logger(DownstreamSyncAdapter.name);
  private config: DownstreamConfig | null = null;

  /**
   * Configure the adapter with connection details
   */
  configure(config: DownstreamConfig): void {
    this.config = config;
    this.logger.log(`Configured downstream adapter for: ${config.baseUrl}`);
  }

  getName(): string {
    return 'DownstreamSystem';
  }

  async testConnection(): Promise<boolean> {
    this.ensureConfigured();
    
    try {
      // Override this to implement your specific health check
      const response = await fetch(`${this.config!.baseUrl}/health`, {
        method: 'GET',
        headers: this.getHeaders(),
      });
      
      return response.ok;
    } catch (error) {
      this.logger.error(`Connection test failed: ${error}`);
      return false;
    }
  }

  async pushOrderChanges(changes: OrderChangePayload[]): Promise<PushBatchResult> {
    const results: PushOrderChangesResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    for (const payload of changes) {
      const result = await this.pushSingleOrderChange(payload);
      results.push(result);
      
      if (result.success) {
        successCount++;
      } else {
        failedCount++;
      }
    }

    return {
      totalOrders: changes.length,
      successCount,
      failedCount,
      orderResults: results,
    };
  }

  async pushSingleOrderChange(payload: OrderChangePayload): Promise<PushOrderChangesResult> {
    this.ensureConfigured();
    
    const orderId = payload.change.orderId;
    const errors: string[] = [];
    let pushedCount = 0;
    let failedCount = 0;

    try {
      // Transform the payload to your downstream API format
      const requestBody = this.transformPayload(payload);
      
      this.logger.debug(`Pushing changes for order ${orderId} to ${this.config!.baseUrl}`);
      
      const response = await fetch(`${this.config!.baseUrl}/orders/changes`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }

      // Count successfully pushed changes
      pushedCount = 1 + payload.itemChanges.length;
      
      this.logger.debug(`Successfully pushed ${pushedCount} changes for order ${orderId}`);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`Order ${orderId}: ${errorMsg}`);
      failedCount = 1 + payload.itemChanges.length;
      this.logger.error(`Failed to push changes for order ${orderId}: ${errorMsg}`);
    }

    return {
      orderId,
      success: errors.length === 0,
      pushedCount,
      failedCount,
      errors,
    };
  }

  /**
   * Transform the change payload to your downstream API format.
   * Override this method to customize the request body structure.
   */
  protected transformPayload(payload: OrderChangePayload): Record<string, unknown> {
    return {
      orderId: payload.change.orderId,
      externalOrderId: payload.orderData?.externalOrderId,
      externalAccountId: payload.orderData?.externalAccountId,
      po: payload.orderData?.po,
      changeType: payload.change.changeType,
      changedFields: payload.change.changedFields,
      orderSnapshot: payload.change.snapshot,
      itemChanges: payload.itemChanges.map(item => ({
        serialNumber: item.serialNumber,
        changeType: item.changeType,
        changedFields: item.changedFields,
        snapshot: item.snapshot,
      })),
      timestamp: new Date().toISOString(),
    };
  }

  protected getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config?.headers,
    };

    if (this.config?.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    return headers;
  }

  private ensureConfigured(): void {
    if (!this.config) {
      throw new Error('DownstreamSyncAdapter not configured. Call configure() first.');
    }
  }
}

