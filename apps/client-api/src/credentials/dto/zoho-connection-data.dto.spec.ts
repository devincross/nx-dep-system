import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ZohoConnectionDataDto } from './zoho-connection-data.dto';

describe('ZohoConnectionDataDto', () => {
  const validZohoData = {
    client_id: '1000.RRML2ZC868TJHX5AQCT7SAAHZ3KQLN',
    client_secret: '62b6aa1b72cddd52bb87bdf5d3df3e131a7b0b8968',
    refresh_token: '1000.refresh_token_example',
  };

  it('should pass validation with all required fields', async () => {
    const dto = plainToInstance(ZohoConnectionDataDto, validZohoData);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail validation when client_id is missing', async () => {
    const { client_id: _omit, ...data } = validZohoData;
    const dto = plainToInstance(ZohoConnectionDataDto, data);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'client_id')).toBe(true);
  });

  it('should fail validation when client_secret is missing', async () => {
    const { client_secret: _omit, ...data } = validZohoData;
    const dto = plainToInstance(ZohoConnectionDataDto, data);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'client_secret')).toBe(true);
  });

  it('should fail validation when refresh_token is missing', async () => {
    const { refresh_token: _omit, ...data } = validZohoData;
    const dto = plainToInstance(ZohoConnectionDataDto, data);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'refresh_token')).toBe(true);
  });
});
