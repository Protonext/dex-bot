import { describe, it, expect, beforeAll } from 'vitest';

// Integration tests hit testnet — skip in CI without network access
// Run with: npm run test:integration

describe('dexapi integration (testnet)', () => {
  let dexapi: typeof import('../../src/dexapi');

  beforeAll(async () => {
    dexapi = await import('../../src/dexapi');
  });

  it('fetchOHLCV returns valid OHLCV array', async () => {
    const candles = await dexapi.fetchOHLCV('XPR_XMD', '1h', 10);

    expect(Array.isArray(candles)).toBe(true);
    if (candles.length > 0) {
      const c = candles[0];
      expect(c).toHaveProperty('open');
      expect(c).toHaveProperty('high');
      expect(c).toHaveProperty('low');
      expect(c).toHaveProperty('close');
      expect(c).toHaveProperty('volume');
    }
  });

  it('fetchDaily returns valid Daily array', async () => {
    const daily = await dexapi.fetchDaily();

    expect(Array.isArray(daily)).toBe(true);
    if (daily.length > 0) {
      const d = daily[0];
      expect(d).toHaveProperty('symbol');
    }
  });

  it('fetchLeaderboard returns Leaderboard array', async () => {
    const leaderboard = await dexapi.fetchLeaderboard([1], '2024-01-01', '2024-12-31');

    expect(Array.isArray(leaderboard)).toBe(true);
  });

  it('fetchTradeHistory returns Trade array', async () => {
    const trades = await dexapi.fetchTradeHistory('metalxdaobot', undefined, 5, 0);

    expect(Array.isArray(trades)).toBe(true);
  });

  it('fetchTransferHistory returns array', async () => {
    const transfers = await dexapi.fetchTransferHistory({
      account: 'metalxdaobot',
      limit: 5,
    });

    expect(Array.isArray(transfers)).toBe(true);
  });

  it('getAllMarketSymbols returns non-empty string array', () => {
    const symbols = dexapi.getAllMarketSymbols();

    expect(Array.isArray(symbols)).toBe(true);
    expect(symbols.length).toBeGreaterThan(0);
    expect(typeof symbols[0]).toBe('string');
  });
});
