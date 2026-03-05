import {
  mysqlTable,
  varchar,
  int,
  boolean,
  timestamp,
  text,
  mysqlEnum,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';

// User status enum values
export const userStatusEnum = ['active', 'inactive', 'suspended'] as const;
export type UserStatus = (typeof userStatusEnum)[number];

// Tenants table - represents a customer/organization
export const tenants = mysqlTable('tenants', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  isActive: boolean('is_active').default(true).notNull(),
  syncEnabled: boolean('sync_enabled').default(false).notNull(), // Enable automated sync job
  metadata: text('metadata'), // JSON string for additional tenant info
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Domains table - each domain has its own database connection
export const domains = mysqlTable('domains', {
  id: varchar('id', { length: 36 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 36 })
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  domain: varchar('domain', { length: 255 }).notNull().unique(),
  isPrimary: boolean('is_primary').default(false).notNull(),
  
  // Database connection details per domain
  dbHost: varchar('db_host', { length: 255 }).notNull(),
  dbPort: int('db_port').default(3306).notNull(),
  dbName: varchar('db_name', { length: 255 }).notNull(),
  dbUser: varchar('db_user', { length: 255 }).notNull(),
  dbPassword: varchar('db_password', { length: 255 }).notNull(),
  
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Users table - admin users for the landlord system
export const users = mysqlTable('users', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: varchar('password', { length: 255 }).notNull(),
  status: mysqlEnum('status', userStatusEnum).default('active').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Relations
export const tenantsRelations = relations(tenants, ({ many }) => ({
  domains: many(domains),
}));

export const domainsRelations = relations(domains, ({ one }) => ({
  tenant: one(tenants, {
    fields: [domains.tenantId],
    references: [tenants.id],
  }),
}));

// Types
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type Domain = typeof domains.$inferSelect;
export type NewDomain = typeof domains.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

