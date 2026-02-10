import { IsString, IsNotEmpty, IsUrl, IsBase64 } from 'class-validator';

/**
 * DTO for validating DEP (Device Enrollment Program) connection data.
 * All fields are required for DEP credentials.
 */
export class DepConnectionDataDto {
  @IsBase64()
  @IsNotEmpty()
  ssl_key!: string;

  @IsBase64()
  @IsNotEmpty()
  ssl_cert!: string;

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

