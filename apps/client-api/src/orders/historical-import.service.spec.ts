import { HistoricalImportService } from './historical-import.service';

jest.mock('@org/database', () => ({}));
jest.mock('../credentials/credentials.service.js', () => ({ CredentialsService: class {} }));
jest.mock('../netsuite/netsuite.service.js', () => ({ NetsuiteService: class {} }));

type FetchCall = { url: string; init?: RequestInit };

describe('HistoricalImportService Zoho fetcher', () => {
  const connData = {
    client_id: 'cid',
    client_secret: 'secret',
    refresh_token: 'refresh',
    orders_module: 'Sales_Orders',
  };

  const service = new HistoricalImportService({} as any, {} as any);
  const buildFetcher = (cd: Record<string, unknown> = connData) =>
    (service as any).buildZohoFetcher(cd) as (
      startDate: Date,
      limit: number,
      page: number,
    ) => Promise<{ data: Record<string, unknown>[]; hasMore: boolean }>;

  let calls: FetchCall[];

  /**
   * Route the three endpoints the fetcher hits: token exchange, field
   * metadata, then the module Get Records call (whose response is configurable).
   */
  const mockFetch = (moduleResponse: {
    ok: boolean;
    status: number;
    body?: unknown;
  }) => {
    calls = [];
    global.fetch = jest.fn(async (url: any, init?: any) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (u.includes('oauth/v2/token')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) } as any;
      }
      if (u.includes('settings/fields')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            fields: [{ api_name: 'id' }, { api_name: 'Account_Name' }, { api_name: 'Product_Details' }],
          }),
        } as any;
      }
      return {
        ok: moduleResponse.ok,
        status: moduleResponse.status,
        json: async () => moduleResponse.body,
      } as any;
    }) as any;
  };

  const moduleCall = () => calls.find((c) => c.url.includes('/crm/v3/Sales_Orders'))!;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('requests the resolved fields list and filters via the If-Modified-Since header', async () => {
    mockFetch({ ok: true, status: 200, body: { data: [{ id: '1' }], info: { next_page_token: 'TKN1' } } });

    const result = await buildFetcher()(new Date('2024-01-01T00:00:00.000Z'), 50, 1);

    const call = moduleCall();
    expect(call.url).toContain('fields=id%2CAccount_Name%2CProduct_Details');
    expect(call.url).toContain('per_page=50');
    expect(call.url).toContain('page=1');
    // No ignored `criteria` param.
    expect(call.url).not.toContain('criteria');
    // Date filter rides the header, not the query string.
    expect((call.init?.headers as Record<string, string>)['If-Modified-Since']).toBe(
      '2024-01-01T00:00:00.000Z',
    );
    // hasMore reflects the presence of a cursor token.
    expect(result).toEqual({ data: [{ id: '1' }], hasMore: true });
  });

  it('pages by cursor token after the first page, never by page offset', async () => {
    // First module response carries a token; the second ends the sequence.
    let n = 0;
    const bodies = [
      { data: [{ id: '1' }], info: { next_page_token: 'TKN1' } },
      { data: [{ id: '2' }], info: {} },
    ];
    calls = [];
    global.fetch = jest.fn(async (url: any, init?: any) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (u.includes('oauth/v2/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) } as any;
      if (u.includes('settings/fields')) return { ok: true, status: 200, json: async () => ({ fields: [{ api_name: 'id' }] }) } as any;
      return { ok: true, status: 200, json: async () => bodies[n++] } as any;
    }) as any;

    const fetcher = buildFetcher();
    const first = await fetcher(new Date('2024-01-01T00:00:00.000Z'), 50, 1);
    const second = await fetcher(new Date('2024-01-01T00:00:00.000Z'), 50, 2);

    const moduleCalls = calls.filter((c) => c.url.includes('/crm/v3/Sales_Orders'));
    expect(first.hasMore).toBe(true);
    expect(second.hasMore).toBe(false);
    // Page 1 uses the page offset; page 2 switches to the cursor and drops it.
    expect(moduleCalls[0].url).toMatch(/[?&]page=1/);
    expect(moduleCalls[1].url).toContain('page_token=TKN1');
    expect(moduleCalls[1].url).not.toMatch(/[?&]page=/);
  });

  it('resolves the field metadata only once across pages', async () => {
    mockFetch({ ok: true, status: 200, body: { data: [], info: { more_records: false } } });

    const fetcher = buildFetcher();
    await fetcher(new Date('2024-01-01T00:00:00.000Z'), 50, 1);
    await fetcher(new Date('2024-01-01T00:00:00.000Z'), 50, 2);

    expect(calls.filter((c) => c.url.includes('settings/fields'))).toHaveLength(1);
  });

  it('treats 304 (nothing modified) as an empty, terminal page', async () => {
    mockFetch({ ok: false, status: 304, body: null });

    const result = await buildFetcher()(new Date('2024-01-01T00:00:00.000Z'), 50, 1);

    expect(result).toEqual({ data: [], hasMore: false });
  });

  it('throws with the Zoho message on a non-OK response instead of swallowing it', async () => {
    mockFetch({ ok: false, status: 400, body: { message: 'INVALID_QUERY' } });

    await expect(buildFetcher()(new Date('2024-01-01T00:00:00.000Z'), 50, 1)).rejects.toThrow(
      /INVALID_QUERY/,
    );
  });
});
