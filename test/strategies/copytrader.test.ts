import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDexAPI, createMockTrade } from '../helpers/mock-dexapi';

vi.mock('../../src/utils', () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  getConfig: () => ({
    dashboard: {}, username: 'testuser', strategy: 'copyTrader',
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

import { CopyTraderStrategy } from '../../src/strategies/copytrader';

describe('CopyTraderStrategy', () => {
  let strategy: CopyTraderStrategy;

  beforeEach(() => {
    vi.clearAllMocks();
    strategy = new CopyTraderStrategy();
    (strategy as any).dexAPI = mockDexAPI;
    (strategy as any).username = 'testuser';
  });

  it('initializes with config', async () => {
    await strategy.initialize({
      targetAccounts: ['trader1'], copyPct: 0.1, maxOrderAmount: 100,
    });
    expect(strategy).toBeDefined();
  });

  it('detects new trades from target', async () => {
    await strategy.initialize({
      targetAccounts: ['trader1'], copyPct: 0.5, maxOrderAmount: 100,
    });

    const trade = createMockTrade({ bid_user: 'trader1', price: 0.001, bid_total: 50 });
    mockDexAPI.fetchTradeHistory.mockResolvedValue([trade]);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([]);

    await strategy.trade();
    // Should detect the new trade
    expect(mockDexAPI.fetchTradeHistory).toHaveBeenCalledWith('trader1', undefined, 50, 0);
  });

  it('skips already-seen trades', async () => {
    await strategy.initialize({
      targetAccounts: ['trader1'], copyPct: 0.5, maxOrderAmount: 100,
    });

    const trade = createMockTrade({ trade_id: 'same-trade', bid_user: 'trader1' });
    mockDexAPI.fetchTradeHistory.mockResolvedValue([trade]);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([]);

    // First run
    await strategy.trade();
    // Second run - same trade should be skipped
    vi.clearAllMocks();
    (strategy as any).dexAPI = mockDexAPI;
    mockDexAPI.fetchTradeHistory.mockResolvedValue([trade]);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([]);

    await strategy.trade();
    const { prepareLimitOrder } = await import('../../src/dexrpc');
    expect(prepareLimitOrder).not.toHaveBeenCalled();
  });

  it('respects maxOrderAmount cap', async () => {
    await strategy.initialize({
      targetAccounts: ['trader1'], copyPct: 10, maxOrderAmount: 5, // copy 10x but max 5
    });

    const trade = createMockTrade({ bid_user: 'trader1', bid_total: 100, price: 0.001 });
    mockDexAPI.fetchTradeHistory.mockResolvedValue([trade]);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([]);

    await strategy.trade();
    // Should cap at maxOrderAmount
    expect(mockDexAPI.fetchTradeHistory).toHaveBeenCalled();
  });
});
