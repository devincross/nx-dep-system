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
export interface TenantInfo {
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  domain: {
    id: string;
    domain: string;
    isPrimary: boolean;
  };
}

export interface HealthStatus {
  status: string;
  timestamp: string;
}

