import { Injectable, Logger } from '@nestjs/common';
import { DataSourcePort, MapperPort, FetchOptions } from '../domain/ports/data-source.port.js';
import {
  AccountRepositoryPort,
  OrderRepositoryPort,
  SyncStatusRepositoryPort,
} from '../domain/ports/repository.port.js';

export interface HistoricalImportOptions {
  /** Pull orders modified since this date */
  startDate: Date;
  /** Max records per API page (controls rate limiting) */
  pageSize?: number;
  /** Delay between pages in ms (rate limiting) */
  pageDelayMs?: number;
}

export interface HistoricalImportResult {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errored: number;
  errors: string[];
  pages: number;
}

@Injectable()
export class HistoricalImportUseCase {
  private readonly logger = new Logger(HistoricalImportUseCase.name);

  /**
   * Import orders from an external source starting from a given date.
   *
   * Key difference from SyncOrdersUseCase:
   * - Disables change tracking on the order repository so imported orders
   *   do NOT create orderChanges entries (prevents DEP push)
   * - Paginates with configurable page size and delay between pages
   * - Marks orders as 'complete' status (already processed)
   */
  async execute(
    dataSource: DataSourcePort,
    mapper: MapperPort,
    accountRepository: AccountRepositoryPort,
    orderRepository: OrderRepositoryPort,
    syncStatusRepository: SyncStatusRepositoryPort,
    options: HistoricalImportOptions,
  ): Promise<HistoricalImportResult> {
    const result: HistoricalImportResult = {
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errored: 0,
      errors: [],
      pages: 0,
    };

    const pageSize = options.pageSize ?? 50;
    const pageDelayMs = options.pageDelayMs ?? 2000;

    const syncStatus = await syncStatusRepository.startSync('orders');
    this.logger.log(
      `Starting historical import from ${options.startDate.toISOString()}, pageSize=${pageSize}`,
    );

    // Disable change tracking so imports don't trigger DEP pushes
    if ('setChangeRepository' in orderRepository) {
      (orderRepository as any).setChangeRepository(null);
    }

    try {
      let hasMore = true;
      let page = 1;

      while (hasMore) {
        const fetchOptions: FetchOptions = {
          lastModified: options.startDate,
          limit: pageSize,
          page,
        };

        this.logger.log(`Fetching page ${page} (limit ${pageSize})...`);
        const fetchResult = await dataSource.fetchOrders(fetchOptions);
        result.pages = page;

        this.logger.log(
          `Page ${page}: ${fetchResult.data.length} orders fetched`,
        );

        if (fetchResult.data.length === 0) {
          hasMore = false;
          break;
        }

        // Process each order
        for (const rawOrder of fetchResult.data) {
          try {
            const orderEntity = mapper.mapOrder(rawOrder);

            if (!orderEntity.externalOrderId) {
              result.skipped++;
              continue;
            }

            // Find or create account
            let account = await accountRepository.findByExternalId(
              orderEntity.externalAccountId,
            );
            if (!account) {
              account = await accountRepository.create({
                externalAccountId: orderEntity.externalAccountId,
                name: `Account ${orderEntity.externalAccountId}`,
              });
            }

            // Upsert order (change tracking is disabled)
            const { created } = await orderRepository.upsert(
              orderEntity,
              account.id,
            );

            result.processed++;
            if (created) result.created++;
            else result.updated++;
          } catch (error) {
            result.errored++;
            const msg =
              error instanceof Error ? error.message : 'Unknown error';
            result.errors.push(msg);
            this.logger.error(`Error importing order: ${msg}`);
          }
        }

        hasMore = fetchResult.hasMore;
        page++;

        // Rate limiting delay between pages
        if (hasMore && pageDelayMs > 0) {
          this.logger.debug(`Waiting ${pageDelayMs}ms before next page...`);
          await new Promise((resolve) => setTimeout(resolve, pageDelayMs));
        }
      }

      await syncStatusRepository.completeSync(syncStatus.id!, {
        recordsProcessed: result.processed,
        recordsCreated: result.created,
        recordsUpdated: result.updated,
        recordsErrored: result.errored,
        errorMessage:
          result.errors.length > 0 ? result.errors[0] : undefined,
        errorDetails:
          result.errors.length > 0
            ? JSON.stringify(result.errors)
            : undefined,
      });

      this.logger.log(
        `Historical import complete: ${result.processed} processed (${result.created} created, ${result.updated} updated), ${result.skipped} skipped, ${result.errored} errors, ${result.pages} pages`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Historical import failed: ${msg}`);

      await syncStatusRepository.completeSync(syncStatus.id!, {
        recordsProcessed: result.processed,
        recordsCreated: result.created,
        recordsUpdated: result.updated,
        recordsErrored: result.errored + 1,
        errorMessage: msg,
      });

      throw error;
    }

    return result;
  }
}
