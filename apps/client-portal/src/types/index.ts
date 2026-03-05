// User types
export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface RegisterDto {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

export interface LoginResponse {
  access_token: string;
  user: User;
}

// Credential types
export type CredentialType = 'dep' | 'zoho' | 'netsuite' | 'database' | 'ssl';
export type CredentialStatus = 'current' | 'disabled';

export interface Credential {
  id: number;
  type: CredentialType;
  status: CredentialStatus;
  connectionData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface CreateCredentialDto {
  type: CredentialType;
  status?: CredentialStatus;
  connectionData: Record<string, unknown>;
}

export interface UpdateCredentialDto {
  status?: CredentialStatus;
  connectionData?: Record<string, unknown>;
}

// Order types
export type OrderStatus = 'waiting' | 'pending' | 'submitted' | 'complete' | 'error' | 'changes';
export type OrderItemDepStatus = 'pending' | 'submitted' | 'complete' | 'error' | 'changes';

export interface OrderItem {
  id: number;
  orderId: number;
  isDep: boolean;
  serialNumber: string;
  depStatus: OrderItemDepStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface Order {
  id: number;
  orderId: string;
  accountId: number;
  externalOrderId?: string;
  externalAccountId?: string;
  externalOrderStatus?: string;
  status: OrderStatus;
  po?: string;
  changes?: string;
  depOrderId?: string;
  source?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  items?: OrderItem[];
}

export interface CreateOrderDto {
  orderId: string;
  accountId: number;
  externalOrderId?: string;
  externalAccountId?: string;
  externalOrderStatus?: string;
  status: OrderStatus;
  po?: string;
  changes?: string;
  depOrderId?: string;
  source?: string;
  items?: CreateOrderItemDto[];
}

export interface UpdateOrderDto {
  externalOrderId?: string;
  externalAccountId?: string;
  externalOrderStatus?: string;
  status?: OrderStatus;
  po?: string;
  changes?: string;
  depOrderId?: string;
  source?: string;
}

export interface CreateOrderItemDto {
  isDep?: boolean;
  serialNumber: string;
  depStatus: OrderItemDepStatus;
}

export interface UpdateOrderItemDto {
  isDep?: boolean;
  serialNumber?: string;
  depStatus?: OrderItemDepStatus;
}

// NetSuite types
export interface NetsuiteStatus {
  id: number;
  status: CredentialStatus;
  createdAt: string;
  updatedAt: string;
}

export interface NetsuiteTestResult {
  success: boolean;
  message: string;
}

export interface NetsuiteResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// Tenant info
export type ConnectionType = 'netsuite' | 'zoho';

export interface TenantInfo {
  tenant: {
    id: string;
    name: string;
    slug: string;
    connectionType: ConnectionType;
  };
  domain: {
    id: string;
    domain: string;
    isPrimary: boolean;
  };
}

export interface ConnectionStatus {
  connectionType: ConnectionType;
  configured: boolean;
  status: 'current' | 'disabled' | 'not_configured' | 'error';
  credentialId?: number;
  createdAt?: string;
  updatedAt?: string;
  message?: string;
  certificateExpiresAt?: string;
  expirationWarning?: string;
}

export interface HealthStatus {
  status: string;
  timestamp: string;
}

// Sync status types
export type SyncStatusType = 'success' | 'error' | 'running' | 'pending';
export type SyncType = 'accounts' | 'orders' | 'full';

export interface SyncStatusResult {
  syncType: SyncType;
  status: SyncStatusType;
  lastSyncAt?: string;
  lastSuccessAt?: string;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsErrored: number;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface SyncSummary {
  accounts: SyncStatusResult | null;
  orders: SyncStatusResult | null;
  totals: {
    totalAccounts: number;
    totalOrders: number;
    totalOrderItems: number;
  };
}

