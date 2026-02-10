import {
  IsIn,
  IsOptional,
  IsObject,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
  validate,
} from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { credentialTypeEnum, credentialStatusEnum } from '@org/database';
import type { ConnectionData } from '@org/database';
import { ZohoConnectionDataDto } from './zoho-connection-data.dto.js';
import { NetsuiteConnectionDataDto } from './netsuite-connection-data.dto.js';
import { DepConnectionDataDto } from './dep-connection-data.dto.js';

/**
 * Custom validator that validates connectionData based on credential type.
 * For 'zoho' type, validates against ZohoConnectionDataDto.
 * For 'netsuite' type, validates against NetsuiteConnectionDataDto.
 * For 'dep' type, validates against DepConnectionDataDto.
 * For other types, just checks it's a valid object.
 * Note: For updates, if type is not provided, validation is skipped
 * (the service should validate against the existing type).
 */
function IsValidConnectionDataForUpdate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isValidConnectionDataForUpdate',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        async validate(value: unknown, args: ValidationArguments) {
          const obj = args.object as UpdateCredentialDto;

          // If connectionData is not provided, skip validation
          if (value === undefined) {
            return true;
          }

          // Must be an object
          if (typeof value !== 'object' || value === null) {
            return false;
          }

          // For zoho type, validate against ZohoConnectionDataDto
          if (obj.type === 'zoho') {
            const zohoData = plainToInstance(ZohoConnectionDataDto, value);
            const errors = await validate(zohoData);
            return errors.length === 0;
          }

          // For netsuite type, validate against NetsuiteConnectionDataDto
          if (obj.type === 'netsuite') {
            const netsuiteData = plainToInstance(
              NetsuiteConnectionDataDto,
              value
            );
            const errors = await validate(netsuiteData);
            return errors.length === 0;
          }

          // For dep type, validate against DepConnectionDataDto
          if (obj.type === 'dep') {
            const depData = plainToInstance(DepConnectionDataDto, value);
            const errors = await validate(depData);
            return errors.length === 0;
          }

          // For other types or when type is not specified, just ensure it's a valid object
          return true;
        },
        defaultMessage(args: ValidationArguments) {
          const obj = args.object as UpdateCredentialDto;
          if (obj.type === 'zoho') {
            return 'connectionData for zoho type must include all required fields: client_id, client_secret, redirect_uri, current_user_email, account_field, is_dep_field, po_field, serials_field, dep_status_field, status, dep_order_id, dep_ordered_at, dep_shipped_at, application_log_file_path, token_persistence_path';
          }
          if (obj.type === 'netsuite') {
            return 'connectionData for netsuite type must include all required fields: netsuite_restlet_host, netsuite_account, client_id, client_secret, netsuite_realm, netsuite_consumer_key, netsuite_consumer_secret, netsuite_token, netsuite_token_secret, netsuite_signature_algorithm, netsuite_deploy_id, netsuite_order_script_id, netsuite_account_script_id, mapping_class';
          }
          if (obj.type === 'dep') {
            return 'connectionData for dep type must include all required fields: ssl_key (base64), ssl_cert (base64), apple_api_url, dep_reseller_id, sap_ship_to, sap_sold_to';
          }
          return 'connectionData must be a valid object';
        },
      },
    });
  };
}

export class UpdateCredentialDto {
  @IsOptional()
  @IsIn(credentialTypeEnum)
  type?: 'dep' | 'zoho' | 'netsuite' | 'database' | 'ssl';

  @IsOptional()
  @IsIn(credentialStatusEnum)
  status?: 'current' | 'disabled';

  /**
   * Connection data - validated based on credential type.
   * For 'zoho' type, must match ZohoConnectionDataDto schema.
   * For other types, must be a valid object.
   */
  @IsOptional()
  @IsObject()
  @IsValidConnectionDataForUpdate()
  connectionData?: ConnectionData;
}

