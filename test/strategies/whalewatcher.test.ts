import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDexAPI } from '../helpers/mock-dexapi';

vi.mock('../../src/utils', () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  getConfig: () => ({
    dashboard: {}, username: 'testuser', strategy: 'whaleWatcher',
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

import { WhaleWatcherStrategy } from '../../src/strategies/whalewatcher';

describe('WhaleWatcherStrategy', () => {
  let strategy: WhaleWatcherStrategy;

  beforeEach(() => {
    vi.clearAllMocks();
    strategy = new WhaleWatcherStrategy();
    (strategy as any).dexAPI = mockDexAPI;
    (strategy as any).username = 'testuser';
  });

  it('initializes with config', async () => {
    await strategy.initialize({
      watchTokens: ['XPR'], minTransferAmount: 100000,
      symbol: 'XPR_XMD', orderAmount: 50, actionDelay: 0,
    });
    expect(strategy).toBeDefined();
  });

  it('detects large transfers', async () => {
    await strategy.initialize({
      watchTokens: ['XPR'], minTransferAmount: 100000,
      symbol: 'XPR_XMD', orderAmount: 50, actionDelay: 0,
    });

    mockDexAPI.fetchTransferHistory.mockResolvedValue([
      { amount: '200000', timestamp: new Date(Date.now() + 1000).toISOString() },
    ]);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([]);

    await strategy.trade();
    expect(mockDexAPI.fetchTransferHistory).toHaveBeenCalled();
  });

  it('filters by amount threshold', async () => {
    await strategy.initialize({
      watchTokens: ['XPR'], minTransferAmount: 100000,
      symbol: 'XPR_XMD', orderAmount: 50, actionDelay: 0,
    });

    // Transfer below threshold
    mockDexAPI.fetchTransferHistory.mockResolvedValue([
      { amount: '500', timestamp: new Date(Date.now() + 1000).toISOString() },
    ]);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([]);

    await strategy.trade();
    const { prepareLimitOrder } = await import('../../src/dexrpc');
    expect(prepareLimitOrder).not.toHaveBeenCalled();
  });

  it('only acts on new transfers', async () => {
    await strategy.initialize({
      watchTokens: ['XPR'], minTransferAmount: 100000,
      symbol: 'XPR_XMD', orderAmount: 50, actionDelay: 0,
    });

    // Transfer with old timestamp
    mockDexAPI.fetchTransferHistory.mockResolvedValue([
      { amount: '200000', timestamp: '2020-01-01T00:00:00.000Z' },
    ]);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([]);

    await strategy.trade();
    const { prepareLimitOrder } = await import('../../src/dexrpc');
    expect(prepareLimitOrder).not.toHaveBeenCalled();
  });
});
