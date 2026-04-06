import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node-fetch
const mockFetch = vi.fn();
vi.mock('node-fetch', () => ({
  default: mockFetch,
}));

vi.mock('../src/utils', () => ({
  getConfig: () => ({
    rpc: {
      apiRoot: 'https://dex.api.test.com/dex',
      lightApiRoot: 'https://lightapi.test.com/api',
    },
  }),
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  getUsername: () => 'testuser',
}));

describe('dexapi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ data: [] }),
    });
  });

  it('fetchOHLCV constructs correct URL', async () => {
    const { fetchOHLCV } = await import('../src/dexapi');

    await fetchOHLCV('XPR_XMD', '1h', 100);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/chart/ohlcv?symbol=XPR_XMD&interval=1h&limit=100')
    );
  });

  it('fetchDaily calls correct endpoint', async () => {
    const { fetchDaily } = await import('../src/dexapi');

    await fetchDaily();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/trades/daily')
    );
  });

  it('fetchLeaderboard constructs correct query params', async () => {
    const { fetchLeaderboard } = await import('../src/dexapi');

    await fetchLeaderboard([1, 2, 3], '2024-01-01', '2024-01-31');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/leaderboard/list?market_ids=1,2,3&from=2024-01-01&to=2024-01-31')
    );
  });

  it('fetchTradeHistory includes account and optional symbol', async () => {
    const { fetchTradeHistory } = await import('../src/dexapi');

    await fetchTradeHistory('testaccount', 'XPR_XMD', 50, 0);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/trades/history?account=testaccount&limit=50&offset=0&symbol=XPR_XMD')
    );
  });

  it('fetchTransferHistory builds query params', async () => {
    const { fetchTransferHistory } = await import('../src/dexapi');

    await fetchTransferHistory({ account: 'user1', symbol: 'XPR', limit: 10 });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/history/transfers?');
    expect(url).toContain('account=user1');
    expect(url).toContain('symbol=XPR');
    expect(url).toContain('limit=10');
  });
});
