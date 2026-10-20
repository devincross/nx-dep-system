import { ZohoAdapter, ZohoConfig } from './zoho.adapter.js';

type FetchCall = { url: string; init?: RequestInit };

const config: ZohoConfig = {
  clientId: 'cid',
  clientSecret: 'secret',
  refreshToken: 'refresh',
  apiDomain: 'https://www.zohoapis.com',
  accountsModule: 'Accounts',
  ordersModule: 'Sales_Orders',
};

describe('ZohoAdapter.fetchOrders', () => {
  let calls: FetchCall[];

  /**
   * Route the three endpoints the adapter hits: token exchange, field
   * metadata, then the module Get Records call. `modulePages` is consumed one
   * response per Get Records request so pagination can be exercised.
   */
  const mockFetch = (modulePages: Array<{ ok: boolean; status: number; body?: unknown }>) => {
    calls = [];
    let pageIdx = 0;
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
          json: async () => ({ fields: [{ api_name: 'id' }, { api_name: 'Product_Details' }] }),
        } as any;
      }
      const resp = modulePages[pageIdx++] ?? { ok: true, status: 200, body: { data: [], info: {} } };
      return { ok: resp.ok, status: resp.status, json: async () => resp.body, text: async () => JSON.stringify(resp.body) } as any;
    }) as any;
  };

  const newAdapter = () => {
    const adapter = new ZohoAdapter();
    adapter.configure(config);
    return adapter;
  };

  const moduleCalls = () => calls.filter((c) => c.url.includes('/crm/v3/Sales_Orders'));

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends the resolved fields list and the If-Modified-Since header, not a criteria param', async () => {
    mockFetch([{ ok: true, status: 200, body: { data: [{ id: '1' }], info: { more_records: false, count: 1 } } }]);

    const result = await newAdapter().fetchOrders({
      lastModified: new Date('2024-01-01T00:00:00.000Z'),
      page: 1,
    });

    const call = moduleCalls()[0];
    expect(call.url).toContain('fields=id%2CProduct_Details');
    expect(call.url).not.toContain('criteria');
    expect((call.init?.headers as Record<string, string>)['If-Modified-Since']).toBe(
      '2024-01-01T00:00:00+00:00',
    );
    expect(result).toEqual({ data: [{ id: '1' }], hasMore: false, totalCount: 1 });
  });

  it('auto-paginates by cursor (page_token), never by page offset, and resolves fields once', async () => {
    mockFetch([
      { ok: true, status: 200, body: { data: [{ id: '1' }], info: { more_records: true, next_page_token: 'TKN1' } } },
      { ok: true, status: 200, body: { data: [{ id: '2' }], info: { more_records: false } } },
    ]);

    const result = await newAdapter().fetchOrders();

    expect(result.data).toEqual([{ id: '1' }, { id: '2' }]);
    expect(result.hasMore).toBe(false);
    const mcalls = moduleCalls();
    expect(mcalls).toHaveLength(2);
    // First request has no cursor; second must carry page_token and never a
    // page offset (offset pagination 400s past 2000 records on Zoho).
    // Match the `page` offset param at a boundary — `per_page=`/`page_token=` must not trip it.
    expect(mcalls[0].url).not.toContain('page_token');
    expect(mcalls[0].url).not.toMatch(/[?&]page=/);
    expect(mcalls[1].url).toContain('page_token=TKN1');
    expect(mcalls[1].url).not.toMatch(/[?&]page=/);
    // Field metadata resolved once and cached across both pages.
    expect(calls.filter((c) => c.url.includes('settings/fields'))).toHaveLength(1);
  });

  it('treats 304 (nothing modified) as an empty result', async () => {
    mockFetch([{ ok: false, status: 304, body: null }]);

    const result = await newAdapter().fetchOrders({
      lastModified: new Date('2024-01-01T00:00:00.000Z'),
      page: 1,
    });

    expect(result).toEqual({ data: [], hasMore: false, totalCount: 0 });
  });

  it('throws on a non-OK response instead of returning empty', async () => {
    mockFetch([{ ok: false, status: 400, body: { message: 'INVALID_QUERY' } }]);

    await expect(
      newAdapter().fetchOrders({ lastModified: new Date('2024-01-01T00:00:00.000Z'), page: 1 }),
    ).rejects.toThrow(/400/);
  });
});
