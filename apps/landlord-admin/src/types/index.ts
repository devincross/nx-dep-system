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
  status: 'active' | 'inactive' | 'suspended';
  createdAt: string;
  updatedAt: string;
}

export interface CreateTenantDto {
  name: string;
  slug: string;
  status?: 'active' | 'inactive' | 'suspended';
}

export interface UpdateTenantDto {
  name?: string;
  slug?: string;
  status?: 'active' | 'inactive' | 'suspended';
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

