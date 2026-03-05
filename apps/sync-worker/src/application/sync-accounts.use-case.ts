import { Injectable, Logger } from '@nestjs/common';
import { DataSourcePort, MapperPort, FetchOptions } from '../domain/ports/data-source.port.js';
import { AccountRepositoryPort, SyncStatusRepositoryPort } from '../domain/ports/repository.port.js';

export interface SyncAccountsResult {
  processed: number;
  created: number;
  updated: number;
  errored: number;
  errors: string[];
}

@Injectable()
export class SyncAccountsUseCase {
  private readonly logger = new Logger(SyncAccountsUseCase.name);

  async execute(
    dataSource: DataSourcePort,
    mapper: MapperPort,
    accountRepository: AccountRepositoryPort,
    syncStatusRepository: SyncStatusRepositoryPort,
    options?: FetchOptions
  ): Promise<SyncAccountsResult> {
    const result: SyncAccountsResult = {
      processed: 0,
      created: 0,
      updated: 0,
      errored: 0,
      errors: [],
    };

    // Start sync tracking
    const syncStatus = await syncStatusRepository.startSync('accounts');
    this.logger.log(`Starting accounts sync (ID: ${syncStatus.id})`);

    try {
      // Fetch accounts from external source
      this.logger.log('Fetching accounts from external source...');
      const fetchResult = await dataSource.fetchAccounts(options);
      this.logger.log(`Fetched ${fetchResult.data.length} accounts`);

      // Process each account
      for (const rawAccount of fetchResult.data) {
        try {
          // Map raw data to domain entity
          const accountEntity = mapper.mapAccount(rawAccount);
          
          if (!accountEntity.externalAccountId) {
            this.logger.warn('Skipping account with no external ID');
            continue;
          }

          // Upsert the account
          const { entity, created } = await accountRepository.upsert(accountEntity);
          
          result.processed++;
          if (created) {
            result.created++;
            this.logger.debug(`Created account: ${entity.externalAccountId}`);
          } else {
            result.updated++;
            this.logger.debug(`Updated account: ${entity.externalAccountId}`);
          }
        } catch (error) {
          result.errored++;
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push(`Account sync error: ${errorMsg}`);
          this.logger.error(`Error processing account: ${errorMsg}`);
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
        `Accounts sync complete: ${result.processed} processed, ` +
        `${result.created} created, ${result.updated} updated, ${result.errored} errors`
      );

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Accounts sync failed: ${errorMsg}`);
      
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

