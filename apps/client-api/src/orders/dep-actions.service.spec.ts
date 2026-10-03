import { DepActionsService } from './dep-actions.service';

jest.mock('@org/database', () => ({}));
jest.mock('../credentials/credentials.service.js', () => ({ CredentialsService: class {} }));
jest.mock('../netsuite/netsuite.service.js', () => ({ NetsuiteService: class {} }));

describe('DepActionsService.submissionOutcome', () => {
  const service = new DepActionsService({} as any, {} as any);
  const outcome = (response: unknown) => (service as any).submissionOutcome(response);

  it('accepts a response with an Apple transaction id', () => {
    expect(outcome({ deviceEnrollmentTransactionId: 'abc' })).toEqual({ accepted: true, errorMessage: null });
  });

  it('rejects a response carrying an error even with HTTP 200', () => {
    expect(outcome({ errorCode: 'E1', errorMessage: 'Bad customer' })).toEqual({
      accepted: false,
      errorMessage: 'Bad customer',
    });
  });

  it('rejects a response with no transaction id and gives a fallback message', () => {
    expect(outcome({})).toEqual({ accepted: false, errorMessage: 'Apple did not accept the submission.' });
  });
});

describe('DepActionsService connection tests', () => {
  const depCred = {
    connectionData: {
      apple_api_url: 'https://dep.example.com', sap_ship_to: '123', dep_reseller_id: 'R1',
      ssl_key: 'KEY', ssl_cert: 'CERT',
    },
  };
  const build = (cred: any) => {
    const credentials = { findNewestActiveByType: jest.fn().mockResolvedValue(cred) };
    const service = new DepActionsService(credentials as any, {} as any);
    return { service, callDep: jest.spyOn(service as any, 'callDep') };
  };

  describe('testDepConnection', () => {
    it('fails clearly when no DEP credentials exist', async () => {
      const { service } = build(null);
      expect(await service.testDepConnection({} as any)).toMatchObject({ ok: false, message: expect.stringContaining('No active DEP') });
    });

    it('lists missing credential fields without calling Apple', async () => {
      const { service, callDep } = build({ connectionData: { apple_api_url: 'https://x' } });
      const result = await service.testDepConnection({} as any);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('sslKey');
      expect(callDep).not.toHaveBeenCalled();
    });

    it('treats an order-not-found answer as connected', async () => {
      const { service, callDep } = build(depCred);
      callDep.mockResolvedValue({ errorCode: 'DEP-ERR-1', errorMessage: 'Order not found' });
      expect((await service.testDepConnection({} as any)).ok).toBe(true);
    });

    it('treats a clean response as connected', async () => {
      const { service, callDep } = build(depCred);
      callDep.mockResolvedValue({ orders: [] });
      expect((await service.testDepConnection({} as any)).ok).toBe(true);
    });

    it('reports any other Apple error verbatim', async () => {
      const { service, callDep } = build(depCred);
      callDep.mockResolvedValue({ errorCode: 'DEP-ERR-9', errorMessage: 'Invalid reseller' });
      expect(await service.testDepConnection({} as any)).toMatchObject({ ok: false, detail: 'DEP-ERR-9: Invalid reseller' });
    });

    it('reports transport failures such as a rejected certificate', async () => {
      const { service, callDep } = build(depCred);
      callDep.mockRejectedValue(new Error('handshake failure'));
      expect(await service.testDepConnection({} as any)).toMatchObject({ ok: false, detail: 'handshake failure' });
    });
  });

  describe('testZohoConnection', () => {
    const zohoCred = { connectionData: { client_id: 'a', client_secret: 'b', refresh_token: 'c' } };
    const realFetch = global.fetch;
    afterEach(() => { global.fetch = realFetch; });

    it('succeeds when the token refresh and module read both work', async () => {
      const { service } = build(zohoCred);
      jest.spyOn(service as any, 'getZohoAccessToken').mockResolvedValue('tok');
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as any;
      expect((await service.testZohoConnection({} as any)).ok).toBe(true);
    });

    it('reports Zoho rejecting the module read', async () => {
      const { service } = build(zohoCred);
      jest.spyOn(service as any, 'getZohoAccessToken').mockResolvedValue('tok');
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: 'invalid oauth scope' }) }) as any;
      expect(await service.testZohoConnection({} as any)).toMatchObject({ ok: false, detail: 'invalid oauth scope' });
    });

    it('reports a failed token refresh', async () => {
      const { service } = build(zohoCred);
      jest.spyOn(service as any, 'getZohoAccessToken').mockRejectedValue(new Error('invalid_code'));
      expect(await service.testZohoConnection({} as any)).toMatchObject({ ok: false, detail: 'invalid_code' });
    });
  });
});
