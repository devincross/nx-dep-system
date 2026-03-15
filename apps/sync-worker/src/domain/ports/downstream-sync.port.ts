import {
  OrderChangeEntity,
  OrderItemChangeEntity,
} from '../entities/index.js';

/**
 * Result of pushing a single change to the downstream system
 */
export interface PushChangeResult {
  /** Whether the push was successful */
  success: boolean;
  
  /** Error message if failed */
  error?: string;
  
  /** External ID or reference from the downstream system */
  externalReference?: string;
}

/**
 * Result of pushing all changes for an order
 */
export interface PushOrderChangesResult {
  /** Order ID that was pushed */
  orderId: number;
  
  /** Whether all changes were pushed successfully */
  success: boolean;
  
  /** Number of changes successfully pushed */
  pushedCount: number;
  
  /** Number of changes that failed */
  failedCount: number;
  
  /** Error details for failed changes */
  errors: string[];
}

/**
 * Batch push result
 */
export interface PushBatchResult {
  /** Total orders processed */
  totalOrders: number;
  
  /** Orders successfully synced */
  successCount: number;
  
  /** Orders with failures */
  failedCount: number;
  
  /** Per-order results */
  orderResults: PushOrderChangesResult[];
}

/**
 * Payload for pushing an order change downstream
 */
export interface OrderChangePayload {
  /** The order change entity */
  change: OrderChangeEntity;
  
  /** Associated item changes for this order (if any in this batch) */
  itemChanges: OrderItemChangeEntity[];
  
  /** Additional order data for context */
  orderData?: {
    externalOrderId: string;
    externalAccountId: string;
    po?: string;
  };
}

/**
 * Port interface for pushing changes to downstream systems
 * Implement this interface for your specific downstream API
 */
export interface DownstreamSyncPort {
  /**
   * Push a batch of order changes to the downstream system
   * @param changes Array of order change payloads to push
   * @returns Result of the batch push operation
   */
  pushOrderChanges(changes: OrderChangePayload[]): Promise<PushBatchResult>;
  
  /**
   * Push a single order's changes to the downstream system
   * @param payload The order change payload
   * @returns Result of pushing this order's changes
   */
  pushSingleOrderChange(payload: OrderChangePayload): Promise<PushOrderChangesResult>;
  
  /**
   * Test the connection to the downstream system
   * @returns true if connection is successful
   */
  testConnection(): Promise<boolean>;
  
  /**
   * Get the name of this downstream system (for logging)
   */
  getName(): string;
}

/**
 * Injection token for downstream sync port
 */
export const DOWNSTREAM_SYNC_PORT = Symbol('DOWNSTREAM_SYNC_PORT');

