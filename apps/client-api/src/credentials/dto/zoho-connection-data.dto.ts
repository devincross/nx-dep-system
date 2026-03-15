import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class ZohoAccountFieldMappings {
  @IsOptional() @IsString() externalAccountId?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() depAccountId?: string;
}

class ZohoOrderFieldMappings {
  @IsOptional() @IsString() externalOrderId?: string;
  @IsOptional() @IsString() externalAccountId?: string;
  @IsOptional() @IsString() externalOrderStatus?: string;
  @IsOptional() @IsString() isDep?: string;
  @IsOptional() @IsString() po?: string;
}

class ZohoOrderItemFieldMappings {
  @IsOptional() @IsString() sourceField?: string;
  @IsOptional() @IsString() serialNumbers?: string;
  @IsOptional() @IsString() isDep?: string;
}

class ZohoFieldMappings {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ZohoAccountFieldMappings)
  account?: ZohoAccountFieldMappings;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ZohoOrderFieldMappings)
  order?: ZohoOrderFieldMappings;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ZohoOrderItemFieldMappings)
  orderItems?: ZohoOrderItemFieldMappings;
}

/**
 * DTO for validating Zoho connection data.
 * Matches what the sync-worker's ZohoAdapter and DynamicZohoMapper consume.
 */
export class ZohoConnectionDataDto {
  @IsString()
  @IsNotEmpty()
  client_id!: string;

  @IsString()
  @IsNotEmpty()
  client_secret!: string;

  @IsString()
  @IsNotEmpty()
  refresh_token!: string;

  @IsOptional()
  @IsString()
  api_domain?: string;

  @IsOptional()
  @IsString()
  accounts_module?: string;

  @IsOptional()
  @IsString()
  orders_module?: string;

  @IsOptional()
  @IsString()
  mapping_class?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ZohoFieldMappings)
  field_mappings?: ZohoFieldMappings;
}
