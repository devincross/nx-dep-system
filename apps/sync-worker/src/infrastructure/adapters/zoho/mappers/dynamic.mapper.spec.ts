import { DynamicZohoMapper, FieldMappingsConfig } from './dynamic.mapper.js';
import { ZohoBaseMapper } from './base.mapper.js';
import { RawAccountData, RawOrderData } from '../../../../domain/ports/data-source.port.js';

// ---------- sample payloads ----------

const sampleAccount: RawAccountData = {
  id: 'ACC-001',
  Id: 'ACC-001',
  Account_Name: 'Acme Corp',
  DEP_Account_ID: 'DEP-42',
};

const sampleOrder: RawOrderData = {
  id: 'ORD-100',
  Id: 'ORD-100',
  SO_Number: 'SO-100',
  Account_Name: { id: 'ACC-001', name: 'Acme Corp' },
  account_id: 'ACC-001',
  Status: 'Approved',
  Is_DEP: true,
  DEP_Eligible: true,
  PO_Number: 'PO-5555',
  Product_Details: [
    { Serial_Numbers: 'SN001,SN002', Serials: 'SN001,SN002', Is_DEP: true, DEP_Eligible: true },
    { Serial_Numbers: 'SN003', Serials: 'SN003', Is_DEP: false, DEP_Eligible: false },
  ],
};

// ---------- parity ----------

describe('DynamicZohoMapper parity with ZohoBaseMapper', () => {
  const dynamic = new DynamicZohoMapper(); // no config → defaults
  const base = new ZohoBaseMapper();

  it('mapAccount produces identical output', () => {
    expect(dynamic.mapAccount(sampleAccount)).toEqual(base.mapAccount(sampleAccount));
  });

  it('mapOrder produces identical output', () => {
    expect(dynamic.mapOrder(sampleOrder)).toEqual(base.mapOrder(sampleOrder));
  });
});

// ---------- custom config ----------

describe('DynamicZohoMapper with custom config', () => {
  const config: FieldMappingsConfig = {
    account: {
      externalAccountId: 'custom_id',
      name: 'company.name',
      depAccountId: 'dep.enrollment_id',
    },
    order: {
      externalOrderId: 'order_num',
      externalAccountId: 'customer.crm_id',
      externalOrderStatus: 'workflow_status',
      isDep: 'metadata.dep_flag',
      po: 'purchase_order_ref',
    },
    orderItems: {
      sourceField: 'line_items',
      serialNumbers: 'serial_list',
      isDep: 'dep_eligible',
    },
  };

  const mapper = new DynamicZohoMapper(config);

  it('maps accounts with custom field names', () => {
    const raw: RawAccountData = {
      custom_id: 'X-1',
      company: { name: 'Custom Corp' },
      dep: { enrollment_id: 'E-99' },
    };

    expect(mapper.mapAccount(raw)).toEqual({
      externalAccountId: 'X-1',
      name: 'Custom Corp',
      depAccountId: 'E-99',
    });
  });

  it('maps orders with custom field names and dot-notation', () => {
    const raw: RawOrderData = {
      order_num: 'ON-500',
      customer: { crm_id: 'C-77' },
      workflow_status: 'Shipped',
      metadata: { dep_flag: 'yes' },
      purchase_order_ref: 'PO-8888',
      line_items: [
        { serial_list: 'AA01;AA02', dep_eligible: true },
      ],
    };

    const result = mapper.mapOrder(raw);

    expect(result.externalOrderId).toBe('ON-500');
    expect(result.externalAccountId).toBe('C-77');
    expect(result.externalOrderStatus).toBe('Shipped');
    expect(result.isDep).toBe(true);
    expect(result.po).toBe('PO-8888');
    expect(result.source).toBe('zoho');
    expect(result.items).toEqual([
      { serialNumber: 'AA01', isDep: true, depStatus: 'pending' },
      { serialNumber: 'AA02', isDep: true, depStatus: 'pending' },
    ]);
  });

  it('returns empty items when sourceField is missing or not an array', () => {
    const raw: RawOrderData = { order_num: 'ON-1' };
    expect(mapper.mapOrder(raw).items).toEqual([]);
  });
});

// ---------- truthy parsing ----------

describe('DynamicZohoMapper custom truthyValues', () => {
  const mapper = new DynamicZohoMapper({
    truthyValues: ['Y', 'Active'],
  });

  it('recognises custom truthy strings', () => {
    const raw: RawOrderData = {
      id: '1',
      Account_Name: { id: '1' },
      Is_DEP: 'Y',
      Product_Details: [],
    };
    expect(mapper.mapOrder(raw).isDep).toBe(true);
  });

  it('rejects values not in custom truthy list', () => {
    const raw: RawOrderData = {
      id: '1',
      Account_Name: { id: '1' },
      Is_DEP: 'true', // 'true' is NOT in custom list
      Product_Details: [],
    };
    expect(mapper.mapOrder(raw).isDep).toBe(false);
  });
});

// ---------- edge cases ----------

describe('DynamicZohoMapper edge cases', () => {
  const mapper = new DynamicZohoMapper();

  it('handles missing optional fields gracefully', () => {
    const raw: RawAccountData = { id: '1' };
    const result = mapper.mapAccount(raw);

    expect(result.externalAccountId).toBe('1');
    expect(result.name).toBe('');
    expect(result.depAccountId).toBeUndefined();
  });

  it('handles order with no status, po, or isDep', () => {
    const raw: RawOrderData = { id: '1', Account_Name: { id: 'A1' } };
    const result = mapper.mapOrder(raw);

    expect(result.externalOrderStatus).toBeUndefined();
    expect(result.po).toBeUndefined();
    expect(result.isDep).toBe(false);
    expect(result.items).toEqual([]);
  });

  it('handles serial numbers with mixed delimiters', () => {
    const raw: RawOrderData = {
      id: '1',
      Account_Name: { id: 'A1' },
      Product_Details: [
        { Serial_Numbers: 'S1,S2;S3\nS4\r\nS5' },
      ],
    };
    const items = mapper.mapOrder(raw).items;
    expect(items.map((i) => i.serialNumber)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5']);
  });

  it('skips empty serial strings after splitting', () => {
    const raw: RawOrderData = {
      id: '1',
      Account_Name: { id: 'A1' },
      Product_Details: [
        { Serial_Numbers: ',,,  , ' },
      ],
    };
    expect(mapper.mapOrder(raw).items).toEqual([]);
  });
});
