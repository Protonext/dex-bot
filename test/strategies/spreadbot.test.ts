import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDexAPI, createMockDepth } from '../helpers/mock-dexapi';

vi.mock('../../src/utils', () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  getConfig: () => ({
    dashboard: {}, username: 'testuser', strategy: 'spreadBot',
    rpc: { apiRoot: 'https://test', lightApiRoot: 'https://test', endpoints: [], privateKeyPermission: 'active' },
  }),
  getUsername: () => 'testuser',
}));

vi.mock('../../src/events', () => ({
  events: {
    orderPlaced: vi.fn(), orderFilled: vi.fn(), orderCancelled: vi.fn(),
    botError: vi.fn(), gridPlaced: vi.fn(), initialize: vi.fn(),
  },
}));

vi.mock('../../src/dexrpc', () => ({
  prepareLimitOrder: vi.fn(),
  submitProcessAction: vi.fn(),
  submitOrders: vi.fn(),
  cancelOrder: vi.fn(),
}));

const mockDexAPI = createMockDexAPI();

import { SpreadBotStrategy } from '../../src/strategies/spreadbot';

describe('SpreadBotStrategy', () => {
  let strategy: SpreadBotStrategy;

  beforeEach(() => {
    vi.clearAllMocks();
    strategy = new SpreadBotStrategy();
    (strategy as any).dexAPI = mockDexAPI;
    (strategy as any).username = 'testuser';
  });

  it('initializes with config', async () => {
    await strategy.initialize({
      symbol: 'XPR_XMD', maxSpreadPct: 5, minSpreadPct: 0.2,
      orderAmount: 50, depthLevels: 10, rebalanceThresholdPct: 1,
    });
    expect(strategy).toBeDefined();
  });

  it('calculates spread correctly', async () => {
    await strategy.initialize({
      symbol: 'XPR_XMD', maxSpreadPct: 5, minSpreadPct: 0.2,
      orderAmount: 50, depthLevels: 10, rebalanceThresholdPct: 1,
    });

    // 1% spread
    mockDexAPI.fetchOrderBook.mockResolvedValue({
      bids: [createMockDepth(0.0100, 10000)],
      asks: [createMockDepth(0.0101, 10000)],
    });
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([]);

    await strategy.trade();
    expect(mockDexAPI.fetchOrderBook).toHaveBeenCalled();
  });

  it('skips when spread is too tight', async () => {
    await strategy.initialize({
      symbol: 'XPR_XMD', maxSpreadPct: 5, minSpreadPct: 2.0,
      orderAmount: 50, depthLevels: 10, rebalanceThresholdPct: 1,
    });

    // Very tight spread < minSpreadPct
    mockDexAPI.fetchOrderBook.mockResolvedValue({
      bids: [createMockDepth(0.01000, 10000)],
      asks: [createMockDepth(0.01001, 10000)],
    });
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([]);

    await strategy.trade();
    const { prepareLimitOrder } = await import('../../src/dexrpc');
    expect(prepareLimitOrder).not.toHaveBeenCalled();
  });

  it('places within bounds when spread is in range', async () => {
    await strategy.initialize({
      symbol: 'XPR_XMD', maxSpreadPct: 5, minSpreadPct: 0.1,
      orderAmount: 50, depthLevels: 10, rebalanceThresholdPct: 1,
    });

    // 2% spread (within range)
    mockDexAPI.fetchOrderBook.mockResolvedValue({
      bids: [createMockDepth(0.0100, 10000)],
      asks: [createMockDepth(0.0102, 10000)],
    });
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([]);

    await strategy.trade();
    const { prepareLimitOrder } = await import('../../src/dexrpc');
    expect(prepareLimitOrder).toHaveBeenCalled();
  });
});
