import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ZohoConnectionDataDto } from './zoho-connection-data.dto';

describe('ZohoConnectionDataDto', () => {
  const validZohoData = {
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

  it('should pass validation with all required fields', async () => {
    const dto = plainToInstance(ZohoConnectionDataDto, validZohoData);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail validation when client_id is missing', async () => {
    const { client_id, ...data } = validZohoData;
    const dto = plainToInstance(ZohoConnectionDataDto, data);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'client_id')).toBe(true);
  });

  it('should fail validation when client_secret is missing', async () => {
    const { client_secret, ...data } = validZohoData;
    const dto = plainToInstance(ZohoConnectionDataDto, data);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'client_secret')).toBe(true);
  });

  it('should fail validation when redirect_uri is not a valid URL', async () => {
    const data = { ...validZohoData, redirect_uri: 'not-a-url' };
    const dto = plainToInstance(ZohoConnectionDataDto, data);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'redirect_uri')).toBe(true);
  });

  it('should fail validation when current_user_email is not a valid email', async () => {
    const data = { ...validZohoData, current_user_email: 'not-an-email' };
    const dto = plainToInstance(ZohoConnectionDataDto, data);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'current_user_email')).toBe(true);
  });

  it('should fail validation when account_field is missing', async () => {
    const { account_field, ...data } = validZohoData;
    const dto = plainToInstance(ZohoConnectionDataDto, data);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'account_field')).toBe(true);
  });

  it('should fail validation when token_persistence_path is missing', async () => {
    const { token_persistence_path, ...data } = validZohoData;
    const dto = plainToInstance(ZohoConnectionDataDto, data);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'token_persistence_path')).toBe(
      true
    );
  });

  it('should fail validation when multiple fields are missing', async () => {
    const dto = plainToInstance(ZohoConnectionDataDto, {
      client_id: '123',
      client_secret: 'secret',
    });
    const errors = await validate(dto);
    // Should have errors for all missing required fields
    expect(errors.length).toBeGreaterThan(5);
  });
});

