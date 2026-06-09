/**
 * Order change type
 */
export type OrderChangeType = 'created' | 'updated' | 'deleted';

/**
 * Order item change type
 */
export type OrderItemChangeType = 'added' | 'updated' | 'removed';

/**
 * Represents a field change with old and new values
 */
export interface FieldChange {
  old: unknown;
  new: unknown;
}

/**
 * Changed fields map
 */
export type ChangedFields = Record<string, FieldChange>;

/**
 * Order change entity - tracks changes to orders
 */
export interface OrderChangeEntity {
  id?: number;
  orderId: number;
  changeType: OrderChangeType;
  changedFields?: ChangedFields;
  snapshot?: Record<string, unknown>;
  syncedAt?: Date;
  createdAt?: Date;
}

/**
 * Order item change entity - tracks changes to order items
 */
export interface OrderItemChangeEntity {
  id?: number;
  orderId: number;
  orderItemId?: number; // nullable for removed items
  serialNumber: string;
  changeType: OrderItemChangeType;
  changedFields?: ChangedFields;
  snapshot?: Record<string, unknown>;
  syncedAt?: Date;
  createdAt?: Date;
}

/**
 * Combined change record for an order including all item changes
 */
export interface OrderChangeRecord {
  orderChange?: OrderChangeEntity;
  itemChanges: OrderItemChangeEntity[];
}

/**
 * Unsynced changes result - for querying changes to push downstream
 */
export interface UnsyncedChanges {
  orderChanges: OrderChangeEntity[];
  itemChanges: OrderItemChangeEntity[];
}

