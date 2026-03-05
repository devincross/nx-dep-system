import { AccountEntity, OrderEntity } from '../entities/index.js';

/**
 * Raw account data from external source (before mapping)
 */
export type RawAccountData = Record<string, unknown>;

/**
 * Raw order data from external source (before mapping)
 */
export type RawOrderData = Record<string, unknown>;

/**
 * Options for fetching data from external source
 */
export interface FetchOptions {
  /** Fetch records modified after this date */
  lastModified?: Date;
  
  /** Maximum number of records to fetch */
  limit?: number;
  
  /** Page/offset for pagination */
  page?: number;
}

/**
 * Result of fetching data from external source
 */
export interface FetchResult<T> {
  /** Fetched records */
  data: T[];
  
  /** Whether there are more records to fetch */
  hasMore: boolean;
  
  /** Total count if available */
  totalCount?: number;
}

/**
 * Data source port interface
 * Adapters for NetSuite, Zoho, etc. implement this interface
 */
export interface DataSourcePort {
  /**
   * Fetch accounts from the external source
   */
  fetchAccounts(options?: FetchOptions): Promise<FetchResult<RawAccountData>>;
  
  /**
   * Fetch orders from the external source
   */
  fetchOrders(options?: FetchOptions): Promise<FetchResult<RawOrderData>>;
  
  /**
   * Test the connection to the external source
   */
  testConnection(): Promise<boolean>;
}

/**
 * Mapper port interface
 * Each tenant can have a custom mapper implementation
 */
export interface MapperPort {
  /**
   * Map raw account data to domain entity
   */
  mapAccount(raw: RawAccountData): AccountEntity;
  
  /**
   * Map raw order data to domain entity
   */
  mapOrder(raw: RawOrderData): OrderEntity;
  
  /**
   * Get the mapper identifier
   */
  getIdentifier(): string;
}

/**
 * Token for dependency injection of DataSourcePort
 */
export const DATA_SOURCE_PORT = Symbol('DATA_SOURCE_PORT');

/**
 * Token for dependency injection of MapperPort
 */
export const MAPPER_PORT = Symbol('MAPPER_PORT');

