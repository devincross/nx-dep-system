// User types
export interface User {
  id: string;
  name: string;
  email: string;
  status: 'active' | 'inactive' | 'suspended';
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserDto {
  name: string;
  email: string;
  password: string;
  status?: 'active' | 'inactive' | 'suspended';
}

export interface UpdateUserDto {
  name?: string;
  email?: string;
  password?: string;
  status?: 'active' | 'inactive' | 'suspended';
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  user: User;
}

// Tenant types
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  syncEnabled: boolean;
  country?: string;
  state?: string;
  city?: string;
  organizationName?: string;
  organizationalUnit?: string;
  metadata?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTenantDto {
  name: string;
  slug: string;
  subdomain: string;
  isActive?: boolean;
  syncEnabled?: boolean;
  metadata?: string;
}

export interface UpdateTenantDto {
  name?: string;
  slug?: string;
  isActive?: boolean;
  syncEnabled?: boolean;
  metadata?: string;
}

// Domain types
export interface Domain {
  id: string;
  tenantId: string;
  domain: string;
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDomainDto {
  tenantId: string;
  domain: string;
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  isPrimary?: boolean;
}

export interface UpdateDomainDto {
  domain?: string;
  dbHost?: string;
  dbPort?: number;
  dbName?: string;
  dbUser?: string;
  dbPassword?: string;
  isPrimary?: boolean;
}


// Users inside a client's (tenant's) own database
export type TenantUserRole = 'admin' | 'user';

export interface TenantUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: TenantUserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface CreateTenantUserDto {
  email: string;
  password: string;
  role?: TenantUserRole;
  firstName?: string;
  lastName?: string;
}

export interface UpdateTenantUserDto {
  email?: string;
  password?: string;
  role?: TenantUserRole;
  isActive?: boolean;
  firstName?: string;
  lastName?: string;
}
