/**
 * Order item domain entity
 */
export interface OrderItemEntity {
  /** Serial number of the product */
  serialNumber: string;
  
  /** Whether this item is DEP eligible */
  isDep: boolean;
  
  /** DEP enrollment status */
  depStatus: 'pending' | 'submitted' | 'complete' | 'error' | 'changes';
}

/**
 * Order domain entity
 * Represents an order from external systems (NetSuite/Zoho)
 */
export interface OrderEntity {
  /** External order ID from the source system */
  externalOrderId: string;
  
  /** External account ID this order belongs to */
  externalAccountId: string;
  
  /** External order status from source system */
  externalOrderStatus?: string;
  
  /** Whether this order is DEP eligible */
  isDep: boolean;
  
  /** Purchase order number */
  po?: string;
  
  /** Order items with serial numbers */
  items: OrderItemEntity[];
  
  /** Source system identifier */
  source?: string;
}

/**
 * Order with internal IDs after persistence
 */
export interface PersistedOrderEntity extends Omit<OrderEntity, 'items'> {
  /** Internal database ID */
  id: number;
  
  /** Internal order UUID */
  orderId: string;
  
  /** Internal account ID (foreign key) */
  accountId: number;
  
  /** Order status in our system */
  status: 'waiting' | 'pending' | 'submitted' | 'complete' | 'error' | 'changes';
  
  /** DEP order ID if submitted */
  depOrderId?: string;
  
  /** DEP ordered timestamp */
  depOrderedAt?: Date;
  
  /** DEP shipped timestamp */
  depShippedAt?: Date;
  
  /** Created timestamp */
  createdAt: Date;
  
  /** Updated timestamp */
  updatedAt: Date;
  
  /** Order items */
  items: PersistedOrderItemEntity[];
}

/**
 * Order item with internal ID after persistence
 */
export interface PersistedOrderItemEntity extends OrderItemEntity {
  /** Internal database ID */
  id: number;
  
  /** Internal order ID (foreign key) */
  orderId: number;
  
  /** Created timestamp */
  createdAt: Date;
  
  /** Updated timestamp */
  updatedAt: Date;
}

