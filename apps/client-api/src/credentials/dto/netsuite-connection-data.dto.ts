import { IsString, IsNotEmpty, IsUrl, IsInt, Min } from 'class-validator';

/**
 * DTO for validating NetSuite connection data.
 * All fields are required for NetSuite credentials.
 */
export class NetsuiteConnectionDataDto {
  @IsUrl()
  @IsNotEmpty()
  netsuite_restlet_host!: string;

  @IsString()
  @IsNotEmpty()
  netsuite_account!: string;

  @IsString()
  @IsNotEmpty()
  client_id!: string;

  @IsString()
  @IsNotEmpty()
  client_secret!: string;

  @IsString()
  @IsNotEmpty()
  netsuite_realm!: string;

  @IsString()
  @IsNotEmpty()
  netsuite_consumer_key!: string;

  @IsString()
  @IsNotEmpty()
  netsuite_consumer_secret!: string;

  @IsString()
  @IsNotEmpty()
  netsuite_token!: string;

  @IsString()
  @IsNotEmpty()
  netsuite_token_secret!: string;

  @IsString()
  @IsNotEmpty()
  netsuite_signature_algorithm!: string;

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

