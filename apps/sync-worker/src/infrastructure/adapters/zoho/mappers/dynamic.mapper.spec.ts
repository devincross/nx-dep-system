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
  // Zoho stores serials in a top-level, delimited field (no line-item subform).
  // Field name is the generic default here; real tenants configure their own.
  Serial_Numbers: 'SN001,SN002',
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

  it('reads delimited serials from a top-level serial field (no subform)', () => {
    // The default Zoho shape: no subform, serials in one delimited field.
    const raw: RawOrderData = {
      id: '1',
      Account_Name: { id: 'A1' },
      Is_DEP: true,
      Serial_Numbers: 'S1,S2;S3\nS4\r\nS5',
    };
    const items = mapper.mapOrder(raw).items;
    expect(items.map((i) => i.serialNumber)).toEqual(['1', '2', '3', '4', '5']);
    expect(items.every((i) => i.isDep)).toBe(true);
  });

  it('reads the top-level serial field NAMED IN CONFIG (e.g. Duke Apple_Serial_Number)', () => {
    // The field name is tenant-specific config, never hardcoded.
    const dukeMapper = new DynamicZohoMapper({
      orderItems: { serialNumbers: 'Apple_Serial_Number' },
    });
    const raw: RawOrderData = {
      id: '1',
      Account_Name: { id: 'A1' },
      Is_DEP: true,
      Apple_Serial_Number: 'AB01,AB02',
    };
    expect(dukeMapper.mapOrder(raw).items.map((i) => i.serialNumber)).toEqual(['AB01', 'AB02']);
  });

  it('skips empty serial strings after splitting', () => {
    const raw: RawOrderData = {
      id: '1',
      Account_Name: { id: 'A1' },
      Apple_Serial_Number: ',,,  , ',
    };
    expect(mapper.mapOrder(raw).items).toEqual([]);
  });

  it('still reads a configured line-item subform when one is provided', () => {
    // Subform support is retained for any tenant that configures it.
    const subformMapper = new DynamicZohoMapper({
      orderItems: { sourceField: 'line_items', serialNumbers: 'sn', isDep: 'dep' },
    });
    const raw: RawOrderData = {
      id: '1',
      Account_Name: { id: 'A1' },
      line_items: [
        { sn: 'AA01,AA02', dep: true },
        { sn: 'AA03', dep: false },
      ],
    };
    const items = subformMapper.mapOrder(raw).items;
    expect(items.map((i) => i.serialNumber)).toEqual(['AA01', 'AA02', 'AA03']);
    expect(items.map((i) => i.isDep)).toEqual([true, true, false]);
  });
});
