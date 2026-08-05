import { Injectable, Logger } from '@nestjs/common';
import { describeError } from './sync-accounts.use-case.js';
import { DataSourcePort, MapperPort, FetchOptions } from '../domain/ports/data-source.port.js';
import {
  AccountRepositoryPort,
  OrderRepositoryPort,
  SyncStatusRepositoryPort,
} from '../domain/ports/repository.port.js';

export interface SyncOrdersResult {
  processed: number;
  created: number;
  updated: number;
  errored: number;
  errors: string[];
}

@Injectable()
export class SyncOrdersUseCase {
  private readonly logger = new Logger(SyncOrdersUseCase.name);

  async execute(
    dataSource: DataSourcePort,
    mapper: MapperPort,
    accountRepository: AccountRepositoryPort,
    orderRepository: OrderRepositoryPort,
    syncStatusRepository: SyncStatusRepositoryPort,
    options?: FetchOptions
  ): Promise<SyncOrdersResult> {
    const result: SyncOrdersResult = {
      processed: 0,
      created: 0,
      updated: 0,
      errored: 0,
      errors: [],
    };

    // Start sync tracking
    const syncStatus = await syncStatusRepository.startSync('orders');
    this.logger.log(`Starting orders sync (ID: ${syncStatus.id})`);

    try {
      // Fetch orders from external source
      this.logger.log('Fetching orders from external source...');
      const fetchResult = await dataSource.fetchOrders(options);
      this.logger.log(`Fetched ${fetchResult.data.length} orders`);

      // Process each order
      for (const rawOrder of fetchResult.data) {
        try {
          // Tenant-specific returns/cancellations (e.g. BYU emits them as
          // transaction_type 'return') remove serials from the orders
          // holding them instead of becoming orders themselves
          const orderReturn = mapper.mapReturn?.(rawOrder);
          if (orderReturn) {
            const removed = await orderRepository.removeItemsBySerial(orderReturn.serialNumbers);
            this.logger.log(
              `Return ${orderReturn.externalOrderId}: removed ${removed.length}/${orderReturn.serialNumbers.length} serials` +
              (removed.length ? ` from order(s) ${[...new Set(removed.map((r) => r.orderId))].join(', ')}` : ''),
            );
            result.processed++;
            result.updated++;
            continue;
          }

          // Map raw data to domain entity
          const orderEntity = mapper.mapOrder(rawOrder);

          if (!orderEntity.externalOrderId) {
            this.logger.warn('Skipping order with no external ID');
            continue;
          }

          // Find the account for this order
          const account = await accountRepository.findByExternalId(orderEntity.externalAccountId);
          
          if (!account) {
            // Create a placeholder account if it doesn't exist
            this.logger.warn(
              `Account ${orderEntity.externalAccountId} not found for order ${orderEntity.externalOrderId}, creating placeholder`
            );
            const newAccount = await accountRepository.create({
              externalAccountId: orderEntity.externalAccountId,
              name: `Account ${orderEntity.externalAccountId}`,
            });
            
            // Upsert the order with the new account
            const { created } = await orderRepository.upsert(orderEntity, newAccount.id);
            result.processed++;
            if (created) result.created++;
            else result.updated++;
            continue;
          }

          // Upsert the order
          const { entity, created } = await orderRepository.upsert(orderEntity, account.id);
          
          result.processed++;
          if (created) {
            result.created++;
            this.logger.debug(`Created order: ${entity.externalOrderId}`);
          } else {
            result.updated++;
            this.logger.debug(`Updated order: ${entity.externalOrderId}`);
          }
        } catch (error) {
          result.errored++;
          const errorMsg = describeError(error);
          result.errors.push(`Order sync error: ${errorMsg}`);
          // Log the first failure in full — the root cause is usually
          // identical for every record, so don't spam the rest
          if (result.errored === 1) {
            this.logger.error(`Error processing order: ${errorMsg}`);
          }
        }
      }

      // Complete sync tracking
      await syncStatusRepository.completeSync(syncStatus.id!, {
        recordsProcessed: result.processed,
        recordsCreated: result.created,
        recordsUpdated: result.updated,
        recordsErrored: result.errored,
        errorMessage: result.errors.length > 0 ? result.errors[0] : undefined,
        errorDetails: result.errors.length > 0 ? JSON.stringify(result.errors) : undefined,
      });

      this.logger.log(
        `Orders sync complete: ${result.processed} processed, ` +
        `${result.created} created, ${result.updated} updated, ${result.errored} errors`
      );

    } catch (error) {
      const errorMsg = describeError(error);
      this.logger.error(`Orders sync failed: ${errorMsg}`);
      
      await syncStatusRepository.completeSync(syncStatus.id!, {
        recordsProcessed: result.processed,
        recordsCreated: result.created,
        recordsUpdated: result.updated,
        recordsErrored: result.errored + 1,
        errorMessage: errorMsg,
        errorDetails: error instanceof Error ? error.stack : undefined,
      });

      throw error;
    }

    return result;
  }
}

