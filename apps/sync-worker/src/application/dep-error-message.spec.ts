import { buildDepErrorMessage } from '@org/dep';

describe('buildDepErrorMessage', () => {
  it('groups device-level errors by code and lists the devices', () => {
    const resp = {
      statusCode: 'COMPLETE_WITH_ERRORS',
      orders: [
        {
          orderNumber: 'SO1',
          orderPostStatus: 'ERROR',
          deliveries: [
            {
              devices: [
                { deviceId: 'AAA', devicePostStatus: 'COMPLETE' },
                {
                  deviceId: 'BBB',
                  devicePostStatus: 'DEP-ERR-DE-4303',
                  devicePostStatusMessage: 'Device ID cannot be used for orders.',
                },
                {
                  deviceId: 'CCC',
                  devicePostStatus: 'DEP-ERR-DE-4303',
                  devicePostStatusMessage: 'Device ID cannot be used for orders.',
                },
                {
                  deviceId: 'DDD',
                  devicePostStatus: 'DEP-ERR-DE-4305',
                  devicePostStatusMessage: 'Device unavailable.',
                },
              ],
            },
          ],
        },
      ],
    };
    const msg = buildDepErrorMessage(resp);
    expect(msg).toContain('DEP-ERR-DE-4303 - Device ID cannot be used for orders. (2 devices: BBB, CCC)');
    expect(msg).toContain('DEP-ERR-DE-4305 - Device unavailable. (1 device: DDD)');
    // completed devices are not reported as errors
    expect(msg).not.toContain('AAA');
  });

  it('falls back to grouped order-level errors (no more "Unknown error" on OR-4109)', () => {
    const resp = {
      statusCode: 'ERROR',
      orders: [
        {
          orderNumber: 'SO29581',
          orderPostStatus: 'DEP-ERR-OR-4109',
          orderPostStatusMessage: 'Order number not found.',
        },
        {
          orderNumber: 'SO29582',
          orderPostStatus: 'DEP-ERR-OR-4109',
          orderPostStatusMessage: 'Order number not found.',
        },
      ],
    };
    const msg = buildDepErrorMessage(resp);
    expect(msg).toBe('DEP-ERR-OR-4109 - Order number not found. (2 orders: SO29581, SO29582)');
    expect(msg).not.toContain('Unknown error');
  });

  it('prefers device-level errors over order-level when both are present', () => {
    const resp = {
      orders: [
        {
          orderNumber: 'SO1',
          orderPostStatus: 'DEP-ERR-OR-4110',
          orderPostStatusMessage: 'Header mismatch.',
          deliveries: [
            {
              devices: [
                {
                  deviceId: 'BBB',
                  devicePostStatus: 'DEP-ERR-DE-4301',
                  devicePostStatusMessage: 'Device ID invalid.',
                },
              ],
            },
          ],
        },
      ],
    };
    const msg = buildDepErrorMessage(resp);
    expect(msg).toContain('DEP-ERR-DE-4301');
    expect(msg).not.toContain('DEP-ERR-OR-4110');
  });

  it('uses the check-transaction error array when there are no order/device errors', () => {
    const resp = {
      checkTransactionErrorResponse: [
        { errorCode: 'DEP-ERR-9999', errorMessage: 'Boom' },
      ],
    };
    expect(buildDepErrorMessage(resp)).toBe('DEP-ERR-9999: Boom');
  });

  it('falls back to the top-level error, then a generic message', () => {
    expect(buildDepErrorMessage({ errorCode: 'X', errorMessage: 'bad' })).toBe('X: bad');
    expect(buildDepErrorMessage({})).toBe('Apple DEP rejected the submission');
    expect(buildDepErrorMessage(null)).toBe('Apple DEP rejected the submission');
  });
});
