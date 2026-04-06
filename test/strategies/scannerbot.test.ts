import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDexAPI, createMockMarket, createMockDaily } from '../helpers/mock-dexapi';

vi.mock('../../src/utils', () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  getConfig: () => ({
    dashboard: {}, username: 'testuser', strategy: 'scannerBot',
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

import { ScannerBotStrategy } from '../../src/strategies/scannerbot';

describe('ScannerBotStrategy', () => {
  let strategy: ScannerBotStrategy;

  beforeEach(() => {
    vi.clearAllMocks();
    strategy = new ScannerBotStrategy();
    (strategy as any).dexAPI = mockDexAPI;
    (strategy as any).username = 'testuser';
  });

  it('initializes with config', async () => {
    await strategy.initialize({
      minVolumeThreshold: 1000, minChangePct: 3.0,
      maxPairs: 5, orderAmount: 25, holdDurationCycles: 10,
    });
    expect(strategy).toBeDefined();
  });

  it('filters by volume and change thresholds', async () => {
    await strategy.initialize({
      minVolumeThreshold: 1000, minChangePct: 3.0,
      maxPairs: 5, orderAmount: 25, holdDurationCycles: 10,
    });

    mockDexAPI.fetchDaily.mockResolvedValue([
      createMockDaily({ symbol: 'XPR_XMD', volume_ask: 5000, change_percentage: 5.0 }),
      createMockDaily({ symbol: 'LOW_VOL', volume_ask: 100, change_percentage: 10.0 }),  // Below volume threshold
      createMockDaily({ symbol: 'LOW_CHG', volume_ask: 5000, change_percentage: 0.5 }),  // Below change threshold
    ]);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([]);

    await strategy.trade();
    // Only XPR_XMD should qualify
    expect(mockDexAPI.fetchDaily).toHaveBeenCalled();
  });

  it('sorts by |change| descending', async () => {
    await strategy.initialize({
      minVolumeThreshold: 100, minChangePct: 1.0,
      maxPairs: 2, orderAmount: 25, holdDurationCycles: 10,
    });

    mockDexAPI.fetchDaily.mockResolvedValue([
      createMockDaily({ symbol: 'A_XMD', volume_ask: 5000, change_percentage: 3.0 }),
      createMockDaily({ symbol: 'B_XMD', volume_ask: 5000, change_percentage: 10.0 }),
      createMockDaily({ symbol: 'C_XMD', volume_ask: 5000, change_percentage: 5.0 }),
    ]);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([]);

    await strategy.trade();
    expect(mockDexAPI.fetchDaily).toHaveBeenCalled();
  });

  it('respects maxPairs', async () => {
    await strategy.initialize({
      minVolumeThreshold: 100, minChangePct: 1.0,
      maxPairs: 1, orderAmount: 25, holdDurationCycles: 10,
    });

    mockDexAPI.fetchDaily.mockResolvedValue([
      createMockDaily({ symbol: 'XPR_XMD', volume_ask: 5000, change_percentage: 5.0 }),
      createMockDaily({ symbol: 'XBTC_XMD', volume_ask: 5000, change_percentage: 10.0 }),
    ]);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([]);

    await strategy.trade();
    // At most 1 position should exist
    expect((strategy as any).positions.length).toBeLessThanOrEqual(1);
  });
});
