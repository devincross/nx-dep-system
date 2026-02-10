import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateCredentialDto } from './create-credential.dto';

describe('CreateCredentialDto', () => {
  const validZohoConnectionData = {
    client_id: '1000.RRML2ZC868TJHX5AQCT7SAAHZ3KQLN',
    client_secret: '62b6aa1b72cddd52bb87bdf5d3df3e131a7b0b8968',
    redirect_uri: 'https://tulane-prod.api.tenant.801saas.com/setup/zohoOauth',
    current_user_email: 'tcorders@tulane.edu',
    account_field: 'DEP_Account_Number',
    is_dep_field: 'Is_DEP',
    po_field: 'Purchase_Order',
    serials_field: 'Apple_Serial_Numbers',
    dep_status_field: 'DEP_Registration_Status',
    status: 'Status',
    dep_order_id: 'SO_Number',
    dep_ordered_at: 'CreatedTime',
    dep_shipped_at: 'ModifiedTime',
    application_log_file_path: 'app/zoho/oauth/logs',
    token_persistence_path: 'app/zoho/oauth/tokens',
  };

  const validNetsuiteConnectionData = {
    netsuite_restlet_host:
      'https://4325477.restlets.api.netsuite.com/app/site/hosting/restlet.nl',
    netsuite_account: '4325477-sb1',
    client_id: '88dda3836f9382221478ba942dceba4685bb828b021624f24aea8eee5ba29ea9',
    client_secret:
      '864491b85d7bdf2fc9fa2f031437d0eff00712aad196f8271dd2884262bff663',
    netsuite_realm: '4325477',
    netsuite_consumer_key:
      '8f6291b3dc9ccce03f733795c2973b116eb7d603aa2536bcee1c3bf0102d45be',
    netsuite_consumer_secret:
      '35cf1134652683c5ea1a6fb1c3260d8d21ef34232b41519e9ceb57110d8f4dd6',
    netsuite_token:
      '3e0dd08cf75d81bdc33111f146ed6a0df219df07dd5aaf0956ed74edb2bec0e1',
    netsuite_token_secret:
      '5859bf348140f5ed51f37bbec61bcf1809d9906d9cf69e693734ea944ceb64df',
    netsuite_signature_algorithm: 'HMAC-SHA1',
    netsuite_deploy_id: 1,
    netsuite_order_script_id: 'customscript_byu_apple_dep_order',
    netsuite_account_script_id: 'customscript_byu_apple_dep_customer',
    mapping_class: 'App\\Repositories\\Tenant\\Netsuite\\Mappings\\ByuMapping',
  };

  const validDepConnectionData = {
    ssl_key: 'LS0tLS1CRUdJTiBSU0EgUFJJVkFURSBLRVktLS0tLQo=',
    ssl_cert: 'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCg==',
    apple_api_url: 'https://api-applecareconnect.apple.com/enroll-service/1.0/',
    dep_reseller_id: '1437BE70',
    sap_ship_to: '0000034451',
    sap_sold_to: '0000034451',
  };

  describe('zoho type validation', () => {
    it('should pass validation with valid zoho connection data', async () => {
      const dto = plainToInstance(CreateCredentialDto, {
        type: 'zoho',
        connectionData: validZohoConnectionData,
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail validation when zoho type has incomplete connection data', async () => {
      const dto = plainToInstance(CreateCredentialDto, {
        type: 'zoho',
        connectionData: {
          client_id: '123',
          client_secret: 'secret',
        },
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'connectionData')).toBe(true);
    });

    it('should fail validation when zoho type has invalid email', async () => {
      const dto = plainToInstance(CreateCredentialDto, {
        type: 'zoho',
        connectionData: {
          ...validZohoConnectionData,
          current_user_email: 'not-an-email',
        },
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should fail validation when zoho type has invalid redirect_uri', async () => {
      const dto = plainToInstance(CreateCredentialDto, {
        type: 'zoho',
        connectionData: {
          ...validZohoConnectionData,
          redirect_uri: 'not-a-url',
        },
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('netsuite type validation', () => {
    it('should pass validation with valid netsuite connection data', async () => {
      const dto = plainToInstance(CreateCredentialDto, {
        type: 'netsuite',
        connectionData: validNetsuiteConnectionData,
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail validation when netsuite type has incomplete connection data', async () => {
      const dto = plainToInstance(CreateCredentialDto, {
        type: 'netsuite',
        connectionData: {
          netsuite_account: '123',
          client_id: 'abc',
        },
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'connectionData')).toBe(true);
    });

    it('should fail validation when netsuite type has invalid restlet_host URL', async () => {
      const dto = plainToInstance(CreateCredentialDto, {
        type: 'netsuite',
        connectionData: {
          ...validNetsuiteConnectionData,
          netsuite_restlet_host: 'not-a-url',
        },
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should fail validation when netsuite_deploy_id is not a positive integer', async () => {
      const dto = plainToInstance(CreateCredentialDto, {
        type: 'netsuite',
        connectionData: {
          ...validNetsuiteConnectionData,
          netsuite_deploy_id: 0,
        },
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('dep type validation', () => {
    it('should pass validation with valid dep connection data', async () => {
      const dto = plainToInstance(CreateCredentialDto, {
        type: 'dep',
        connectionData: validDepConnectionData,
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail validation when dep type has incomplete connection data', async () => {
      const dto = plainToInstance(CreateCredentialDto, {
        type: 'dep',
        connectionData: {
          ssl_key: 'LS0tLS1CRUdJTg==',
          ssl_cert: 'LS0tLS1CRUdJTg==',
        },
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'connectionData')).toBe(true);
    });

    it('should fail validation when dep type has invalid apple_api_url', async () => {
      const dto = plainToInstance(CreateCredentialDto, {
        type: 'dep',
        connectionData: {
          ...validDepConnectionData,
          apple_api_url: 'not-a-url',
        },
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should fail validation when ssl_key is not base64', async () => {
      const dto = plainToInstance(CreateCredentialDto, {
        type: 'dep',
        connectionData: {
          ...validDepConnectionData,
          ssl_key: 'not-base64!!!',
        },
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('other type validation', () => {
    it('should pass validation for database type with any object', async () => {
      const dto = plainToInstance(CreateCredentialDto, {
        type: 'database',
        connectionData: { host: 'localhost', port: 3306 },
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should pass validation for ssl type with any object', async () => {
      const dto = plainToInstance(CreateCredentialDto, {
        type: 'ssl',
        connectionData: { certificate: 'cert', key: 'key' },
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  describe('general validation', () => {
    it('should fail validation when type is invalid', async () => {
      const dto = plainToInstance(CreateCredentialDto, {
        type: 'invalid',
        connectionData: { key: 'value' },
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'type')).toBe(true);
    });

    it('should fail validation when connectionData is missing', async () => {
      const dto = plainToInstance(CreateCredentialDto, {
        type: 'dep',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'connectionData')).toBe(true);
    });

    it('should fail validation when connectionData is not an object', async () => {
      const dto = plainToInstance(CreateCredentialDto, {
        type: 'dep',
        connectionData: 'not-an-object',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});

