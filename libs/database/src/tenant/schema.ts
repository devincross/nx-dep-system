import {
  mysqlTable,
  varchar,
  boolean,
  timestamp,
  text,
  int,
  bigint,
  mysqlEnum,
  char,
  uniqueIndex,
  index,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';

// Example tenant schema - users table
// This is a template that each tenant database will have
export const users = mysqlTable('users', {
  id: varchar('id', { length: 36 }).primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  firstName: varchar('first_name', { length: 255 }),
  lastName: varchar('last_name', { length: 255 }),
  passwordHash: varchar('password_hash', { length: 255 }),
  isActive: boolean('is_active').default(true).notNull(),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Example: roles table
export const roles = mysqlTable('roles', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  description: text('description'),
  permissions: text('permissions'), // JSON string of permissions
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Example: user_roles junction table
export const userRoles = mysqlTable('user_roles', {
  id: int('id').primaryKey().autoincrement(),
  userId: varchar('user_id', { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  roleId: varchar('role_id', { length: 36 })
    .notNull()
    .references(() => roles.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Credential type and status enums
export const credentialTypeEnum = ['dep', 'zoho', 'netsuite', 'database', 'ssl'] as const;
export type CredentialType = (typeof credentialTypeEnum)[number];

export const credentialStatusEnum = ['current', 'disabled'] as const;
export type CredentialStatus = (typeof credentialStatusEnum)[number];

// Connection data type for credentials (used in DTOs and service layer)
export type ConnectionData = Record<string, unknown>;

// Credentials table - stores various credential types with soft delete
// Note: connectionData is stored as encrypted text in the database
// Encryption/decryption is handled by the CredentialsService
export const credentials = mysqlTable('credentials', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  type: mysqlEnum('type', credentialTypeEnum).notNull(),
  status: mysqlEnum('status', credentialStatusEnum).default('current').notNull(),
  connectionData: text('connection_data').notNull(),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
  deletedAt: timestamp('deleted_at'),
});

// Accounts table - customer accounts
export const accounts = mysqlTable('accounts', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  externalAccountId: varchar('external_account_id', { length: 255 }),
  depAccountId: varchar('dep_account_id', { length: 255 }), // DEP enrollment account ID
  name: varchar('name', { length: 255 }),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
});

// Sync status enum
export const syncStatusEnum = ['success', 'error', 'running', 'pending'] as const;
export type SyncStatusType = (typeof syncStatusEnum)[number];

// Sync type enum
export const syncTypeEnum = ['accounts', 'orders', 'full'] as const;
export type SyncType = (typeof syncTypeEnum)[number];

// Sync status table - tracks sync runs and their status
export const syncStatus = mysqlTable('sync_status', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  syncType: mysqlEnum('sync_type', syncTypeEnum).notNull(),
  status: mysqlEnum('status', syncStatusEnum).notNull(),
  lastSyncAt: timestamp('last_sync_at'),
  lastSuccessAt: timestamp('last_success_at'),
  recordsProcessed: int('records_processed').default(0),
  recordsCreated: int('records_created').default(0),
  recordsUpdated: int('records_updated').default(0),
  recordsErrored: int('records_errored').default(0),
  errorMessage: text('error_message'),
  errorDetails: text('error_details'), // JSON string with detailed error info
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Order status enum
export const orderStatusEnum = [
  'waiting',
  'pending',
  'submitted',
  'complete',
  'error',
  'changes',
] as const;
export type OrderStatus = (typeof orderStatusEnum)[number];

// Orders table
export const orders = mysqlTable(
  'orders',
  {
    id: bigint('id', { mode: 'number', unsigned: true })
      .primaryKey()
      .autoincrement(),
    orderId: char('order_id', { length: 36 }).notNull(),
    accountId: bigint('account_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => accounts.id),
    externalOrderId: varchar('external_order_id', { length: 255 }),
    externalAccountId: varchar('external_account_id', { length: 255 }),
    externalOrderStatus: varchar('external_order_status', { length: 255 }),
    status: mysqlEnum('status', orderStatusEnum).notNull(),
    po: varchar('po', { length: 255 }),
    changes: text('changes'),
    depOrderId: char('dep_order_id', { length: 36 }),
    depOrderedAt: timestamp('dep_ordered_at'),
    depShippedAt: timestamp('dep_shipped_at'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
    source: varchar('source', { length: 255 }),
  },
  (table) => [
    uniqueIndex('orders_external_order_id_unique').on(table.externalOrderId),
    index('orders_account_id_foreign').on(table.accountId),
  ]
);

// Order item DEP status enum
export const orderItemDepStatusEnum = [
  'pending',
  'submitted',
  'complete',
  'error',
  'changes',
] as const;
export type OrderItemDepStatus = (typeof orderItemDepStatusEnum)[number];

// Order items table
export const orderItems = mysqlTable(
  'order_items',
  {
    id: bigint('id', { mode: 'number', unsigned: true })
      .primaryKey()
      .autoincrement(),
    orderId: bigint('order_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => orders.id),
    isDep: boolean('is_dep').default(false).notNull(),
    serialNumber: varchar('serial_number', { length: 255 }).notNull(),
    depStatus: mysqlEnum('dep_status', orderItemDepStatusEnum).notNull(),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('products_order_id_foreign').on(table.orderId),
    index('products_serial_number_index').on(table.serialNumber),
  ]
);

// Relations
export const accountsRelations = relations(accounts, ({ many }) => ({
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  account: one(accounts, {
    fields: [orders.accountId],
    references: [accounts.id],
  }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
}));

// Order change type enum
export const orderChangeTypeEnum = ['created', 'updated', 'deleted'] as const;
export type OrderChangeType = (typeof orderChangeTypeEnum)[number];

// Order item change type enum
export const orderItemChangeTypeEnum = ['added', 'updated', 'removed'] as const;
export type OrderItemChangeType = (typeof orderItemChangeTypeEnum)[number];

// Order changes table - tracks changes to orders for downstream sync
export const orderChanges = mysqlTable(
  'order_changes',
  {
    id: bigint('id', { mode: 'number', unsigned: true })
      .primaryKey()
      .autoincrement(),
    orderId: bigint('order_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => orders.id),
    changeType: mysqlEnum('change_type', orderChangeTypeEnum).notNull(),
    changedFields: text('changed_fields'), // JSON: {"field": {"old": x, "new": y}}
    snapshot: text('snapshot'), // JSON: full order state at time of change
    syncedAt: timestamp('synced_at'), // null until pushed to downstream system
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('order_changes_order_id_idx').on(table.orderId),
    index('order_changes_synced_at_idx').on(table.syncedAt),
  ]
);

// Order item changes table - tracks changes to order items for downstream sync
export const orderItemChanges = mysqlTable(
  'order_item_changes',
  {
    id: bigint('id', { mode: 'number', unsigned: true })
      .primaryKey()
      .autoincrement(),
    orderId: bigint('order_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => orders.id),
    orderItemId: bigint('order_item_id', { mode: 'number', unsigned: true })
      .references(() => orderItems.id), // nullable for removed items
    serialNumber: varchar('serial_number', { length: 255 }).notNull(),
    changeType: mysqlEnum('change_type', orderItemChangeTypeEnum).notNull(),
    changedFields: text('changed_fields'), // JSON: {"field": {"old": x, "new": y}}
    snapshot: text('snapshot'), // JSON: full item state at time of change
    syncedAt: timestamp('synced_at'), // null until pushed to downstream system
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('order_item_changes_order_id_idx').on(table.orderId),
    index('order_item_changes_order_item_id_idx').on(table.orderItemId),
    index('order_item_changes_synced_at_idx').on(table.syncedAt),
  ]
);

// Relations for change tables
export const orderChangesRelations = relations(orderChanges, ({ one }) => ({
  order: one(orders, {
    fields: [orderChanges.orderId],
    references: [orders.id],
  }),
}));

export const orderItemChangesRelations = relations(orderItemChanges, ({ one }) => ({
  order: one(orders, {
    fields: [orderItemChanges.orderId],
    references: [orders.id],
  }),
  orderItem: one(orderItems, {
    fields: [orderItemChanges.orderItemId],
    references: [orderItems.id],
  }),
}));

// DEP transaction status enum
export const depTransactionStatusEnum = ['pending', 'in_progress', 'complete', 'error', 'posted_with_errors'] as const;
export type DepTransactionStatus = (typeof depTransactionStatusEnum)[number];

// DEP order type enum
export const depOrderTypeEnum = ['OR', 'RE', 'VD', 'OV', 'SC'] as const;
export type DepOrderType = (typeof depOrderTypeEnum)[number];

// DEP transactions table - tracks every Apple DEP API interaction (required 3-7 year retention)
export const depTransactions = mysqlTable(
  'dep_transactions',
  {
    id: bigint('id', { mode: 'number', unsigned: true })
      .primaryKey()
      .autoincrement(),
    orderId: bigint('order_id', { mode: 'number', unsigned: true })
      .references(() => orders.id),
    transactionId: varchar('transaction_id', { length: 255 }).notNull(), // our unique ID per request
    deviceEnrollmentTransactionId: varchar('device_enrollment_transaction_id', { length: 512 }), // Apple's ID
    orderType: mysqlEnum('order_type', depOrderTypeEnum).notNull(),
    status: mysqlEnum('status', depTransactionStatusEnum).default('pending').notNull(),
    requestPayload: text('request_payload'), // full JSON request (for audit)
    responsePayload: text('response_payload'), // full JSON response (for audit)
    errorCode: varchar('error_code', { length: 100 }),
    errorMessage: text('error_message'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    index('dep_txn_order_id_idx').on(table.orderId),
    index('dep_txn_transaction_id_idx').on(table.transactionId),
    index('dep_txn_enrollment_id_idx').on(table.deviceEnrollmentTransactionId),
    index('dep_txn_status_idx').on(table.status),
  ]
);

export const depTransactionsRelations = relations(depTransactions, ({ one }) => ({
  order: one(orders, {
    fields: [depTransactions.orderId],
    references: [orders.id],
  }),
}));

// Types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type UserRole = typeof userRoles.$inferSelect;
export type NewUserRole = typeof userRoles.$inferInsert;
export type Credential = typeof credentials.$inferSelect;
export type NewCredential = typeof credentials.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
export type SyncStatus = typeof syncStatus.$inferSelect;
export type NewSyncStatus = typeof syncStatus.$inferInsert;
export type OrderChange = typeof orderChanges.$inferSelect;
export type NewOrderChange = typeof orderChanges.$inferInsert;
export type OrderItemChange = typeof orderItemChanges.$inferSelect;
export type NewOrderItemChange = typeof orderItemChanges.$inferInsert;
export type DepTransaction = typeof depTransactions.$inferSelect;
export type NewDepTransaction = typeof depTransactions.$inferInsert;

