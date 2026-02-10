// Main exports for @org/database

// Landlord database exports
export {
  tenants,
  domains,
  users as landlordUsers,
  tenantsRelations,
  domainsRelations,
  userStatusEnum,
} from './landlord/schema.js';

export type {
  Tenant,
  NewTenant,
  Domain,
  NewDomain,
  User as LandlordUser,
  NewUser as NewLandlordUser,
  UserStatus,
} from './landlord/schema.js';

export {
  createLandlordConnection,
  getLandlordDb,
  closeLandlordConnection,
} from './landlord/connection.js';

export type { LandlordDb } from './landlord/connection.js';

// Tenant database exports
export {
  users,
  roles,
  userRoles,
  credentials,
  credentialTypeEnum,
  credentialStatusEnum,
  accounts,
  orders,
  orderItems,
  orderStatusEnum,
  orderItemDepStatusEnum,
  accountsRelations,
  ordersRelations,
  orderItemsRelations,
} from './tenant/schema.js';

export type {
  User,
  NewUser,
  Role,
  NewRole,
  UserRole,
  NewUserRole,
  Credential,
  NewCredential,
  CredentialType,
  CredentialStatus,
  ConnectionData,
  Account,
  NewAccount,
  Order,
  NewOrder,
  OrderItem,
  NewOrderItem,
  OrderStatus,
  OrderItemDepStatus,
} from './tenant/schema.js';

export {
  getTenantConnection,
  closeTenantConnection,
  closeAllTenantConnections,
} from './tenant/connection-manager.js';

export type { TenantDb } from './tenant/connection-manager.js';

