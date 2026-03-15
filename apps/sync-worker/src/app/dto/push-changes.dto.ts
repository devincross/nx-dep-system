import {
  IsString,
  IsOptional,
  IsInt,
  IsArray,
  IsUrl,
  Min,
  Max,
} from 'class-validator';

/**
 * Request DTO for triggering a push of order changes
 */
export class PushChangesRequestDto {
  /**
   * Tenant slug to push changes for.
   * If not provided, pushes for all sync-enabled tenants.
   */
  @IsOptional()
  @IsString()
  tenantSlug?: string;

  /**
   * Maximum number of orders to process in one push.
   * Default: 100
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  batchSize?: number;

  /**
   * Only push changes for specific order IDs
   */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  orderIds?: number[];
}

/**
 * Configuration for the downstream system.
 * Required if not already configured.
 */
export class DownstreamConfigDto {
  @IsUrl()
  baseUrl!: string;

  @IsOptional()
  @IsString()
  apiKey?: string;
}

/**
 * Response for a single tenant's push result
 */
export interface TenantPushResult {
  tenantSlug: string;
  success: boolean;
  totalOrders: number;
  successCount: number;
  failedCount: number;
  orderChangesSynced: number;
  itemChangesSynced: number;
  errors: string[];
}

/**
 * Response DTO for push changes endpoint
 */
export interface PushChangesResponseDto {
  /** Overall success status */
  success: boolean;
  
  /** Human-readable message */
  message: string;
  
  /** Timestamp of the push operation */
  timestamp: string;
  
  /** Total tenants processed */
  tenantsProcessed: number;
  
  /** Results per tenant */
  results: TenantPushResult[];
  
  /** Summary statistics */
  summary: {
    totalOrdersProcessed: number;
    totalSuccessful: number;
    totalFailed: number;
    totalOrderChangesSynced: number;
    totalItemChangesSynced: number;
  };
}

/**
 * Response for querying pending changes
 */
export interface PendingChangesResponseDto {
  tenantSlug: string;
  pendingOrderChanges: number;
  pendingItemChanges: number;
  oldestChangeAt?: string;
}

