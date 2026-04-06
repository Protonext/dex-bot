import { vi } from 'vitest';
import type { Market, OrderHistory, Trade, OHLCV, Daily, Leaderboard, Depth } from '@proton/wrap-constants';

export function createMockMarket(overrides: Partial<Market> = {}): Market {
  return {
    market_id: 1,
    symbol: 'XPR_XMD',
    status_code: 1,
    type: 'spot',
    maker_fee: 0.1,
    taker_fee: 0.2,
    order_min: 0.01,
    bid_token: {
      code: 'XPR',
      precision: 4,
      contract: 'eosio.token',
      multiplier: 10000,
    },
    ask_token: {
      code: 'XMD',
      precision: 6,
      contract: 'eosio.token',
      multiplier: 1000000,
    },
    ...overrides,
  } as Market;
}

export function createMockOHLCV(overrides: Partial<OHLCV> = {}): OHLCV {
  return {
    time: Date.now(),
    open: 0.001,
    high: 0.0012,
    low: 0.0009,
    close: 0.0011,
    volume: 10000,
    volume_bid: 5000,
    count: 50,
    ...overrides,
  };
}

export function createMockDaily(overrides: Partial<Daily> = {}): Daily {
  return {
    market_id: 1,
    symbol: 'XPR_XMD',
    open: 0.001,
    high: 0.0012,
    low: 0.0009,
    close: 0.0011,
    volume_bid: 5000,
    volume_ask: 10000,
    change_percentage: 5.0,
    ...overrides,
  };
}

export function createMockTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    block_num: '100',
    block_time: new Date().toISOString(),
    trade_id: `trade-${Math.random().toString(36).slice(2)}`,
    market_id: 1,
    price: 0.001,
    bid_user: 'buyer1',
    bid_user_order_id: 'order-1',
    bid_user_ordinal_order_id: '1',
    bid_total: 100,
    bid_amount: 100000,
    bid_fee: 0.1,
    bid_referrer: '',
    bid_referrer_fee: 0,
    ask_user: 'seller1',
    ask_user_order_id: 'order-2',
    ask_user_ordinal_order_id: '2',
    ask_total: 100,
    ask_amount: 100000,
    ask_fee: 0.1,
    ask_referrer: '',
    ask_referrer_fee: 0,
    order_side: 1,
    trx_id: 'trx-1',
    ...overrides,
  } as Trade;
}

export function createMockOrderHistory(overrides: Partial<OrderHistory> = {}): OrderHistory {
  return {
    block_time: new Date().toISOString(),
    order_id: `order-${Math.random().toString(36).slice(2)}`,
    ordinal_order_id: '1',
    market_id: 1,
    quantity_curr: 100,
    price: 0.001,
    account_name: 'testuser',
    order_side: 1,
    order_type: 1,
    trigger_price: 0,
    fill_type: 0,
    status: 'open',
    ...overrides,
  } as OrderHistory;
}

export function createMockDepth(level: number, quantity: number): Depth {
  return { level, bid: quantity, ask: quantity, count: 1 };
}

export function createMockDexAPI() {
  return {
    fetchMarkets: vi.fn().mockResolvedValue([createMockMarket()]),
    fetchOrderBook: vi.fn().mockResolvedValue({
      bids: [createMockDepth(0.001, 10000)],
      asks: [createMockDepth(0.0012, 10000)],
    }),
    fetchOpenOrders: vi.fn().mockResolvedValue([]),
    fetchPairOpenOrders: vi.fn().mockResolvedValue([]),
    fetchOrderHistory: vi.fn().mockResolvedValue([]),
    fetchTrades: vi.fn().mockResolvedValue([]),
    fetchLatestPrice: vi.fn().mockResolvedValue(0.001),
    fetchBalances: vi.fn().mockResolvedValue([]),
    fetchTokenBalance: vi.fn().mockResolvedValue('0'),
    fetchOHLCV: vi.fn().mockResolvedValue([]),
    fetchDaily: vi.fn().mockResolvedValue([]),
    fetchLeaderboard: vi.fn().mockResolvedValue([]),
    fetchTransferHistory: vi.fn().mockResolvedValue([]),
    fetchTradeHistory: vi.fn().mockResolvedValue([]),
    getAllMarketSymbols: vi.fn().mockReturnValue(['XPR_XMD']),
    getMarketById: vi.fn().mockReturnValue(createMockMarket()),
    getMarketBySymbol: vi.fn().mockReturnValue(createMockMarket()),
    initialize: vi.fn().mockResolvedValue(undefined),
  };
}
