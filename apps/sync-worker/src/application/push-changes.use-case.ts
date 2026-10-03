import { Injectable, Logger } from '@nestjs/common';
import { OrderChangeRepositoryPort } from '../domain/ports/repository.port.js';
import {
  DownstreamSyncPort,
  OrderChangePayload,
} from '../domain/ports/downstream-sync.port.js';
import { OrderRepositoryPort } from '../domain/ports/repository.port.js';
import { OrderChangeEntity, OrderItemChangeEntity } from '../domain/entities/index.js';

export interface PushChangesResult {
  /** Total orders with changes */
  totalOrders: number;
  
  /** Orders successfully synced */
  successCount: number;
  
  /** Orders with failures */
  failedCount: number;
  
  /** Order changes marked as synced */
  orderChangesSynced: number;
  
  /** Item changes marked as synced */
  itemChangesSynced: number;
  
  /** Errors encountered */
  errors: string[];
}

@Injectable()
export class PushChangesUseCase {
  private readonly logger = new Logger(PushChangesUseCase.name);

  /**
   * Execute the push changes workflow
   * 
   * @param changeRepository Repository for querying/marking changes
   * @param orderRepository Repository for fetching order details
   * @param downstreamSync Adapter for pushing to downstream system
   * @param options Optional configuration
   */
  async execute(
    changeRepository: OrderChangeRepositoryPort,
    orderRepository: OrderRepositoryPort,
    downstreamSync: DownstreamSyncPort,
    options?: {
      /** Maximum number of orders to process in one run */
      batchSize?: number;
      /** Only process changes for specific order IDs */
      orderIds?: number[];
    }
  ): Promise<PushChangesResult> {
    const result: PushChangesResult = {
      totalOrders: 0,
      successCount: 0,
      failedCount: 0,
      orderChangesSynced: 0,
      itemChangesSynced: 0,
      errors: [],
    };

    this.logger.log(`Starting push changes to ${downstreamSync.getName()}`);

    try {
      // Fetch all unsynced changes
      const unsyncedChanges = await changeRepository.findUnsyncedChanges();
      
      this.logger.log(
        `Found ${unsyncedChanges.orderChanges.length} order changes and ` +
        `${unsyncedChanges.itemChanges.length} item changes to sync`
      );

      if (unsyncedChanges.orderChanges.length === 0 && unsyncedChanges.itemChanges.length === 0) {
        this.logger.log('No changes to push');
        return result;
      }

      // Group changes by order ID
      const changesByOrder = this.groupChangesByOrder(
        unsyncedChanges.orderChanges,
        unsyncedChanges.itemChanges
      );

      // Apply batch size limit if specified
      let orderIds = Array.from(changesByOrder.keys());
      if (options?.orderIds) {
        orderIds = orderIds.filter(id => options.orderIds!.includes(id));
      }
      if (options?.batchSize) {
        orderIds = orderIds.slice(0, options.batchSize);
      }

      result.totalOrders = orderIds.length;

      // Build payloads with order context
      const payloads: OrderChangePayload[] = [];
      for (const orderId of orderIds) {
        const changes = changesByOrder.get(orderId)!;
        const order = await orderRepository.findById(orderId);
        
        // If order change exists, create payload with it
        // Otherwise just create payload for item changes
        const orderChange = changes.orderChanges[0]; // Usually just one per order
        
        payloads.push({
          change: orderChange ?? {
            orderId,
            changeType: 'updated', // Item-only changes are effectively updates
          } as OrderChangeEntity,
          itemChanges: changes.itemChanges,
          orderData: order ? {
            externalOrderId: order.externalOrderId,
            externalAccountId: order.externalAccountId,
            po: order.po,
          } : undefined,
        });
      }

      // Push to downstream system
      const pushResult = await downstreamSync.pushOrderChanges(payloads);

      // Process results and mark successful changes as synced
      for (const orderResult of pushResult.orderResults) {
        if (orderResult.success) {
          result.successCount++;
          
          // Mark changes as synced
          const changes = changesByOrder.get(orderResult.orderId);
          if (changes) {
            const orderChangeIds = changes.orderChanges
              .filter(c => c.id !== undefined)
              .map(c => c.id!);
            const itemChangeIds = changes.itemChanges
              .filter(c => c.id !== undefined)
              .map(c => c.id!);

            if (orderChangeIds.length > 0) {
              await changeRepository.markOrderChangesSynced(orderChangeIds);
              result.orderChangesSynced += orderChangeIds.length;
            }
            if (itemChangeIds.length > 0) {
              await changeRepository.markItemChangesSynced(itemChangeIds);
              result.itemChangesSynced += itemChangeIds.length;
            }
          }
        } else {
          result.failedCount++;
          result.errors.push(...orderResult.errors);
        }
      }

      this.logger.log(
        `Push complete: ${result.successCount} orders synced, ` +
        `${result.failedCount} failed, ` +
        `${result.orderChangesSynced} order changes marked synced, ` +
        `${result.itemChangesSynced} item changes marked synced`
      );

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Push changes failed: ${errorMsg}`);
      result.errors.push(errorMsg);
      throw error;
    }

    return result;
  }

  /**
   * Group order and item changes by order ID
   */
  private groupChangesByOrder(
    orderChanges: OrderChangeEntity[],
    itemChanges: OrderItemChangeEntity[]
  ): Map<number, { orderChanges: OrderChangeEntity[]; itemChanges: OrderItemChangeEntity[] }> {
    const map = new Map<number, { orderChanges: OrderChangeEntity[]; itemChanges: OrderItemChangeEntity[] }>();

    // Add order changes
    for (const change of orderChanges) {
      if (!map.has(change.orderId)) {
        map.set(change.orderId, { orderChanges: [], itemChanges: [] });
      }
      map.get(change.orderId)!.orderChanges.push(change);
    }

    // Add item changes
    for (const change of itemChanges) {
      if (!map.has(change.orderId)) {
        map.set(change.orderId, { orderChanges: [], itemChanges: [] });
      }
      map.get(change.orderId)!.itemChanges.push(change);
    }

    return map;
  }
}

