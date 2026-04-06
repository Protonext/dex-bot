import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDexAPI, createMockOHLCV } from '../helpers/mock-dexapi';

vi.mock('../../src/utils', () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  getConfig: () => ({
    dashboard: {}, username: 'testuser', strategy: 'twapBot',
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
}));

const mockDexAPI = createMockDexAPI();

import { TWAPBotStrategy } from '../../src/strategies/twapbot';

describe('TWAPBotStrategy', () => {
  let strategy: TWAPBotStrategy;

  beforeEach(() => {
    vi.clearAllMocks();
    strategy = new TWAPBotStrategy();
    (strategy as any).dexAPI = mockDexAPI;
    (strategy as any).username = 'testuser';
  });

  it('initializes with config', async () => {
    await strategy.initialize({
      symbol: 'XPR_XMD', side: 'BUY', totalAmount: 1000,
      durationMinutes: 60, sliceCount: 10, maxSlippage: 2, avoidHighVolatility: false,
    });
    expect(strategy).toBeDefined();
  });

  it('executes first slice immediately', async () => {
    await strategy.initialize({
      symbol: 'XPR_XMD', side: 'BUY', totalAmount: 100,
      durationMinutes: 10, sliceCount: 5, maxSlippage: 10, avoidHighVolatility: false,
    });

    mockDexAPI.fetchLatestPrice.mockResolvedValue(0.001);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([]);

    await strategy.trade();
    const { prepareLimitOrder } = await import('../../src/dexrpc');
    expect(prepareLimitOrder).toHaveBeenCalled();
    expect((strategy as any).slicesExecuted).toBe(1);
  });

  it('does not execute extra orders after completion', async () => {
    await strategy.initialize({
      symbol: 'XPR_XMD', side: 'BUY', totalAmount: 100,
      durationMinutes: 1, sliceCount: 1, maxSlippage: 10, avoidHighVolatility: false,
    });

    mockDexAPI.fetchLatestPrice.mockResolvedValue(0.001);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([]);

    // Execute the only slice
    await strategy.trade();
    expect((strategy as any).slicesExecuted).toBe(1);

    // Second call should do nothing
    vi.clearAllMocks();
    (strategy as any).dexAPI = mockDexAPI;
    await strategy.trade();
    const { prepareLimitOrder } = await import('../../src/dexrpc');
    expect(prepareLimitOrder).not.toHaveBeenCalled();
  });

  it('skips high volatility when configured', async () => {
    await strategy.initialize({
      symbol: 'XPR_XMD', side: 'BUY', totalAmount: 100,
      durationMinutes: 10, sliceCount: 5, maxSlippage: 10, avoidHighVolatility: true,
    });

    mockDexAPI.fetchLatestPrice.mockResolvedValue(0.001);
    // Very volatile candles
    const volatileCandles = [
      createMockOHLCV({ close: 0.001 }),
      createMockOHLCV({ close: 0.010 }), // 10x jump
      createMockOHLCV({ close: 0.001 }),
    ];
    mockDexAPI.fetchOHLCV.mockResolvedValue(volatileCandles);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([]);

    await strategy.trade();
    // Should skip due to high volatility
    const { prepareLimitOrder } = await import('../../src/dexrpc');
    expect(prepareLimitOrder).not.toHaveBeenCalled();
  });
});
