import { IsString, IsNotEmpty, IsEmail, IsUrl } from 'class-validator';

/**
 * DTO for validating Zoho connection data.
 * All fields are required for Zoho credentials.
 */
export class ZohoConnectionDataDto {
  @IsString()
  @IsNotEmpty()
  client_id!: string;

  @IsString()
  @IsNotEmpty()
  client_secret!: string;

  @IsUrl()
  @IsNotEmpty()
  redirect_uri!: string;

  @IsEmail()
  @IsNotEmpty()
  current_user_email!: string;

  @IsString()
  @IsNotEmpty()
  account_field!: string;

  @IsString()
  @IsNotEmpty()
  is_dep_field!: string;

  @IsString()
  @IsNotEmpty()
  po_field!: string;

  @IsString()
  @IsNotEmpty()
  serials_field!: string;

  @IsString()
  @IsNotEmpty()
  dep_status_field!: string;

  @IsString()
  @IsNotEmpty()
  status!: string;

  @IsString()
  @IsNotEmpty()
  dep_order_id!: string;

  @IsString()
  @IsNotEmpty()
  dep_ordered_at!: string;

  @IsString()
  @IsNotEmpty()
  dep_shipped_at!: string;

  @IsString()
  @IsNotEmpty()
  application_log_file_path!: string;

  @IsString()
  @IsNotEmpty()
  token_persistence_path!: string;
}

