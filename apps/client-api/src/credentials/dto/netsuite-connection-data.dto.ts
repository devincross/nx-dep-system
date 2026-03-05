import { IsString, IsNotEmpty, IsUrl, IsInt, Min, IsOptional, IsIn } from 'class-validator';

/**
 * DTO for validating NetSuite connection data.
 * Supports both OAuth 1.0a (TBA) and OAuth 2.0 (M2M) authentication.
 */
export class NetsuiteConnectionDataDto {
  /**
   * Authentication type: 'oauth1' (TBA) or 'oauth2' (M2M)
   * Default: 'oauth1' for backward compatibility
   */
  @IsOptional()
  @IsIn(['oauth1', 'oauth2'])
  auth_type?: 'oauth1' | 'oauth2';

  @IsUrl()
  @IsNotEmpty()
  netsuite_restlet_host!: string;

  @IsString()
  @IsNotEmpty()
  netsuite_account!: string;

  // OAuth 2.0 M2M fields
  @IsOptional()
  @IsString()
  client_id?: string;

  @IsOptional()
  @IsString()
  certificate_id?: string;

  @IsOptional()
  @IsString()
  private_key?: string; // PEM format or base64 encoded

  // OAuth 1.0a TBA fields (kept for backward compatibility)
  @IsOptional()
  @IsString()
  client_secret?: string;

  @IsOptional()
  @IsString()
  netsuite_realm?: string;

  @IsOptional()
  @IsString()
  netsuite_consumer_key?: string;

  @IsOptional()
  @IsString()
  netsuite_consumer_secret?: string;

  @IsOptional()
  @IsString()
  netsuite_token?: string;

  @IsOptional()
  @IsString()
  netsuite_token_secret?: string;

  @IsOptional()
  @IsString()
  netsuite_signature_algorithm?: string;

  // Common fields
  @IsInt()
  @Min(1)
  netsuite_deploy_id!: number;

  @IsString()
  @IsNotEmpty()
  netsuite_order_script_id!: string;

  @IsString()
  @IsNotEmpty()
  netsuite_account_script_id!: string;

  @IsString()
  @IsNotEmpty()
  mapping_class!: string;
}

