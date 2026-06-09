import { IsString, IsNotEmpty, IsUrl, IsOptional } from 'class-validator';

/**
 * DTO for validating DEP (Device Enrollment Program) connection data.
 *
 * ssl_key and ssl_cert are optional at creation time because:
 * - CSR flow: key is generated first, cert arrives later from Apple
 * - Migration flow: both are provided up front as PEM strings
 */
export class DepConnectionDataDto {
  @IsOptional()
  @IsString()
  ssl_key?: string;

  @IsOptional()
  @IsString()
  ssl_cert?: string;

  @IsUrl()
  @IsNotEmpty()
  apple_api_url!: string;

  @IsString()
  @IsNotEmpty()
  dep_reseller_id!: string;

  @IsString()
  @IsNotEmpty()
  sap_ship_to!: string;

  @IsString()
  @IsNotEmpty()
  sap_sold_to!: string;
}
