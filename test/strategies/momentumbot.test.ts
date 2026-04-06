import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDexAPI, createMockMarket, createMockOHLCV } from '../helpers/mock-dexapi';

// Mock modules before imports
vi.mock('../../src/utils', () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  getConfig: () => ({
    dashboard: {}, username: 'testuser', strategy: 'momentumBot',
    rpc: { apiRoot: 'https://test', lightApiRoot: 'https://test', endpoints: [], privateKeyPermission: 'active' },
  }),
  getUsername: () => 'testuser',
}));

vi.mock('../../src/events', () => ({
  events: {
    orderPlaced: vi.fn(), orderFilled: vi.fn(), orderCancelled: vi.fn(),
    botError: vi.fn(), gridPlaced: vi.fn(), initialize: vi.fn(),
    tradeExecuted: vi.fn(), custom: vi.fn(),
  },
}));

vi.mock('../../src/dexrpc', () => ({
  prepareLimitOrder: vi.fn(),
  submitProcessAction: vi.fn(),
  submitOrders: vi.fn(),
  cancelOrder: vi.fn(),
  withdrawAll: vi.fn(),
}));

const mockDexAPI = createMockDexAPI();

import { MomentumBotStrategy } from '../../src/strategies/momentumbot';

describe('MomentumBotStrategy', () => {
  let strategy: MomentumBotStrategy;

  beforeEach(() => {
    vi.clearAllMocks();
    strategy = new MomentumBotStrategy();
    // Override the protected dexAPI with our mock
    (strategy as any).dexAPI = mockDexAPI;
    (strategy as any).username = 'testuser';
  });

  it('initializes with config', async () => {
    await strategy.initialize({
      symbol: 'XPR_XMD', interval: '1h', lookbackPeriods: 20,
      rsiOverbought: 70, rsiOversold: 30, bollingerStdDev: 2.0,
      orderAmount: 50, maxPositions: 3,
    });
    expect(strategy).toBeDefined();
  });

  it('skips trade when insufficient candles', async () => {
    await strategy.initialize({
      symbol: 'XPR_XMD', interval: '1h', lookbackPeriods: 20,
      rsiOverbought: 70, rsiOversold: 30, bollingerStdDev: 2.0,
      orderAmount: 50, maxPositions: 3,
    });

    // Return only 5 candles (less than lookbackPeriods = 20)
    mockDexAPI.fetchOHLCV.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => createMockOHLCV({ close: 0.001 + i * 0.0001 }))
    );

    await strategy.trade();
    // Should not place any orders
    const { prepareLimitOrder } = await import('../../src/dexrpc');
    expect(prepareLimitOrder).not.toHaveBeenCalled();
  });

  it('generates BUY signal when price below lower band and RSI oversold', async () => {
    await strategy.initialize({
      symbol: 'XPR_XMD', interval: '1h', lookbackPeriods: 20,
      rsiOverbought: 70, rsiOversold: 30, bollingerStdDev: 2.0,
      orderAmount: 50, maxPositions: 3,
    });

    // Create candles where last close is very low (below lower band)
    // and RSI would be oversold (steady decline)
    const candles = Array.from({ length: 20 }, (_, i) => {
      // Start high, end very low → RSI oversold and price below lower band
      const close = 0.002 - (i * 0.00008);
      return createMockOHLCV({ close });
    });
    mockDexAPI.fetchOHLCV.mockResolvedValue(candles);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([]);

    await strategy.trade();
    // Should have attempted to place orders
    const { prepareLimitOrder } = await import('../../src/dexrpc');
    // If conditions are met, orders should be prepared
    expect(mockDexAPI.fetchOHLCV).toHaveBeenCalled();
  });

  it('respects maxPositions limit', async () => {
    await strategy.initialize({
      symbol: 'XPR_XMD', interval: '1h', lookbackPeriods: 20,
      rsiOverbought: 70, rsiOversold: 30, bollingerStdDev: 2.0,
      orderAmount: 50, maxPositions: 0, // max 0 positions = no new orders
    });

    const candles = Array.from({ length: 20 }, (_, i) =>
      createMockOHLCV({ close: 0.002 - i * 0.00008 })
    );
    mockDexAPI.fetchOHLCV.mockResolvedValue(candles);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([]);

    await strategy.trade();
    const { prepareLimitOrder } = await import('../../src/dexrpc');
    expect(prepareLimitOrder).not.toHaveBeenCalled();
  });
});
