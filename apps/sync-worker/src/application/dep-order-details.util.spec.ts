import { extractAppleSerials, diffDeviceSets } from './dep-order-details.util.js';
import type { ShowOrderDetailsResponse } from '../infrastructure/adapters/dep/dep-sync.adapter.js';

describe('extractAppleSerials', () => {
  it('indexes order number -> sorted unique serials', () => {
    const resp: ShowOrderDetailsResponse = {
      orders: [
        {
          orderNumber: 'SO-1',
          deliveries: [
            { deliveryNumber: 'D1', shipDate: '', devices: [{ deviceId: 'C02B' }, { deviceId: 'C02A' }] },
            { deliveryNumber: 'D2', shipDate: '', devices: [{ deviceId: 'C02A' }] },
          ],
        },
      ],
    };
    const map = extractAppleSerials(resp);
    expect(map.get('SO-1')).toEqual(['C02A', 'C02B']);
  });

  it('returns an empty map when Apple returns no orders', () => {
    expect(extractAppleSerials({}).size).toBe(0);
  });
});

describe('diffDeviceSets', () => {
  it('flags devices missing from Apple as critical + ov_restore when our/Zoho agree', () => {
    const d = diffDeviceSets({ our: ['A', 'B'], zoho: ['A', 'B'], apple: ['A'] });
    expect(d.missingFromApple).toEqual(['B']);
    expect(d.zohoMatch).toBe(true);
    expect(d.appleMatch).toBe(false);
    expect(d.recommendedAction).toBe('ov_restore');
    expect(d.severity).toBe('critical');
  });

  it('recommends investigate (not ov_restore) when our DB and Zoho disagree', () => {
    const d = diffDeviceSets({ our: ['A'], zoho: ['A', 'B'], apple: ['A'] });
    expect(d.missingFromApple).toEqual(['B']); // B expected via Zoho union
    expect(d.zohoMatch).toBe(false);
    expect(d.recommendedAction).toBe('investigate');
    expect(d.severity).toBe('critical');
  });

  it('matches cleanly when all three agree', () => {
    const d = diffDeviceSets({ our: ['A', 'B'], zoho: ['B', 'A'], apple: ['A', 'B'] });
    expect(d.appleMatch).toBe(true);
    expect(d.zohoMatch).toBe(true);
    expect(d.missingFromApple).toEqual([]);
    expect(d.recommendedAction).toBe('none');
    expect(d.severity).toBe('ok');
  });

  it('marks not_in_apple when the order is absent from Apple', () => {
    const d = diffDeviceSets({ our: ['A'], zoho: ['A'], apple: null });
    expect(d.appleMatch).toBeNull();
    expect(d.recommendedAction).toBe('not_in_apple');
    expect(d.severity).toBe('warn'); // expected devices but none in Apple
  });

  it('marks not_in_zoho when the order is absent from Zoho', () => {
    const d = diffDeviceSets({ our: ['A'], zoho: null, apple: ['A'] });
    expect(d.zohoMatch).toBeNull();
    expect(d.recommendedAction).toBe('none');
  });

  it('reports extra devices in Apple as a warning', () => {
    const d = diffDeviceSets({ our: ['A'], zoho: ['A'], apple: ['A', 'X'] });
    expect(d.extraInApple).toEqual(['X']);
    expect(d.missingFromApple).toEqual([]);
    expect(d.severity).toBe('warn');
    expect(d.recommendedAction).toBe('investigate');
  });
});
