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
  name: varchar('name', { length: 255 }),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
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

