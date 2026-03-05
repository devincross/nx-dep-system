import {
  AccountEntity,
  PersistedAccountEntity,
  OrderEntity,
  PersistedOrderEntity,
} from '../entities/index.js';

/**
 * Sync status for tracking sync runs
 */
export interface SyncStatusEntity {
  id?: number;
  syncType: 'accounts' | 'orders' | 'full';
  status: 'success' | 'error' | 'running' | 'pending';
  lastSyncAt?: Date;
  lastSuccessAt?: Date;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsErrored: number;
  errorMessage?: string;
  errorDetails?: string;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * Account repository port interface
 */
export interface AccountRepositoryPort {
  /**
   * Find account by external ID
   */
  findByExternalId(externalAccountId: string): Promise<PersistedAccountEntity | null>;
  
  /**
   * Create a new account
   */
  create(account: AccountEntity): Promise<PersistedAccountEntity>;
  
  /**
   * Update an existing account
   */
  update(id: number, account: Partial<AccountEntity>): Promise<PersistedAccountEntity>;
  
  /**
   * Upsert account (create or update based on external ID)
   */
  upsert(account: AccountEntity): Promise<{ entity: PersistedAccountEntity; created: boolean }>;
}

/**
 * Order repository port interface
 */
export interface OrderRepositoryPort {
  /**
   * Find order by external ID
   */
  findByExternalId(externalOrderId: string): Promise<PersistedOrderEntity | null>;
  
  /**
   * Create a new order with items
   */
  create(order: OrderEntity, accountId: number): Promise<PersistedOrderEntity>;
  
  /**
   * Update an existing order
   */
  update(id: number, order: Partial<OrderEntity>): Promise<PersistedOrderEntity>;
  
  /**
   * Upsert order (create or update based on external ID)
   */
  upsert(order: OrderEntity, accountId: number): Promise<{ entity: PersistedOrderEntity; created: boolean }>;
}

/**
 * Sync status repository port interface
 */
export interface SyncStatusRepositoryPort {
  /**
   * Get the latest sync status for a sync type
   */
  getLatest(syncType: 'accounts' | 'orders' | 'full'): Promise<SyncStatusEntity | null>;
  
  /**
   * Create a new sync status entry
   */
  create(status: Omit<SyncStatusEntity, 'id'>): Promise<SyncStatusEntity>;
  
  /**
   * Update an existing sync status
   */
  update(id: number, status: Partial<SyncStatusEntity>): Promise<SyncStatusEntity>;
  
  /**
   * Start a new sync run
   */
  startSync(syncType: 'accounts' | 'orders' | 'full'): Promise<SyncStatusEntity>;
  
  /**
   * Complete a sync run with results
   */
  completeSync(
    id: number,
    results: {
      recordsProcessed: number;
      recordsCreated: number;
      recordsUpdated: number;
      recordsErrored: number;
      errorMessage?: string;
      errorDetails?: string;
    }
  ): Promise<SyncStatusEntity>;
}

/**
 * Tokens for dependency injection
 */
export const ACCOUNT_REPOSITORY_PORT = Symbol('ACCOUNT_REPOSITORY_PORT');
export const ORDER_REPOSITORY_PORT = Symbol('ORDER_REPOSITORY_PORT');
export const SYNC_STATUS_REPOSITORY_PORT = Symbol('SYNC_STATUS_REPOSITORY_PORT');

