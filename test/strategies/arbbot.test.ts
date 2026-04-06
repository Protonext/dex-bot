import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDexAPI, createMockDepth } from '../helpers/mock-dexapi';

vi.mock('../../src/utils', () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  getConfig: () => ({
    dashboard: {}, username: 'testuser', strategy: 'arbBot',
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

import { ArbBotStrategy } from '../../src/strategies/arbbot';

describe('ArbBotStrategy', () => {
  let strategy: ArbBotStrategy;

  beforeEach(() => {
    vi.clearAllMocks();
    strategy = new ArbBotStrategy();
    (strategy as any).dexAPI = mockDexAPI;
    (strategy as any).username = 'testuser';
  });

  it('initializes with config', async () => {
    await strategy.initialize({
      pairs: ['XPR_XMD', 'XBTC_XMD', 'XPR_XBTC'],
      minProfitPct: 0.5, orderAmount: 50,
    });
    expect(strategy).toBeDefined();
  });

  it('requires exactly 3 pairs', async () => {
    await expect(strategy.initialize({
      pairs: ['A', 'B'] as any,
      minProfitPct: 0.5, orderAmount: 50,
    })).rejects.toThrow('exactly 3 pairs');
  });

  it('does not trade when no arb opportunity', async () => {
    await strategy.initialize({
      pairs: ['XPR_XMD', 'XBTC_XMD', 'XPR_XBTC'],
      minProfitPct: 0.5, orderAmount: 50,
    });

    // Equal prices → no arb
    mockDexAPI.fetchOrderBook.mockResolvedValue({
      bids: [createMockDepth(1.0, 10000)],
      asks: [createMockDepth(1.0, 10000)],
    });
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([]);

    await strategy.trade();
    const { prepareLimitOrder } = await import('../../src/dexrpc');
    expect(prepareLimitOrder).not.toHaveBeenCalled();
  });

  it('handles missing orderbook data gracefully', async () => {
    await strategy.initialize({
      pairs: ['XPR_XMD', 'XBTC_XMD', 'XPR_XBTC'],
      minProfitPct: 0.5, orderAmount: 50,
    });

    // Empty orderbook
    mockDexAPI.fetchOrderBook.mockResolvedValue({
      bids: [],
      asks: [],
    });

    await strategy.trade();
    const { prepareLimitOrder } = await import('../../src/dexrpc');
    expect(prepareLimitOrder).not.toHaveBeenCalled();
  });
});
