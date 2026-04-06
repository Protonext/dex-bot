import { Depth, Market, OrderHistory, Trade, OHLCV, Daily, Leaderboard } from '@proton/wrap-constants';
import fetch from 'node-fetch';
import { getConfig } from './utils';
import { healthMonitor, EndpointCategory } from './health-monitor';

// Contains methods for interacting with the off-chain DEX API
const { apiRoot } = getConfig().rpc;
const { lightApiRoot } = getConfig().rpc;

function getEndpointCategory(root: string): EndpointCategory {
  return root === lightApiRoot ? 'lightApi' : 'dexApi';
}

/**
 * Generic GET request to one of the APIs
 */
const fetchFromAPI = async <T>(root: string, path: string, returnData = true, times = 3): Promise<T> => {
  const category = getEndpointCategory(root);
  try {
    const response = await fetch(`${root}${path}`);
    const responseJson = await response.json() as any;
    healthMonitor.recordSuccess(category);
    if (returnData) {
      return responseJson.data as T;
    }
    return responseJson;
  }
  catch {
    if (times > 0) {
      times--;
      return await fetchFromAPI(root, path, returnData, times);
    } else {
      const msg = `Not able to reach API server: ${root}`;
      healthMonitor.recordError(category, msg);
      throw new Error(msg);
    }
  }
};

// export async const fetchFromAPI = async <T>(root: string, path: string, returnData = true, retries: number): Promise<T> => {
//   fetch(`${root}${path}`)
//     .then(res => {
//       if (res.ok) {
//         const responseJson = await res.json() as any;
//         if (returnData) {
//           return responseJson.data as T;
//         }
//         return responseJson;
//       }
//       if (retries > 0) {
//         return fetchFromAPI(root, path, returnData, retries)
//       }
//       throw new Error()
//     })
//     .catch(error => console.error(error.message))
//   }

export const fetchMarkets = async (): Promise<Market[]> => {
  const marketData = await fetchFromAPI<Market[]>(apiRoot, '/v1/markets/all');
  return marketData;
};

/**
 * Return an orderbook for the provided market. Use a higher step number for low priced currencies
 */
export const fetchOrderBook = async (symbol: string, limit = 100, step = 100000): Promise<{ bids: Depth[], asks: Depth[] }> => {
  const orderBook = await fetchFromAPI<{ bids: Depth[], asks: Depth[] }>(apiRoot, `/v1/orders/depth?symbol=${symbol}&limit=${limit}&step=${step}`);
  return orderBook;
};

/**
 * Get all open orders for a given user
 * @param {string} username - name of proton user/account to retrieve orders for
 * @returns  {Promise<array>} - list of all open orders
 */
export const fetchOpenOrders = async (username: string, limit = 250, offset = 0): Promise<OrderHistory[]> => {
  const openOrders = await fetchFromAPI<OrderHistory[]>(apiRoot, `/v1/orders/open?limit=${limit}&offset=${offset}&account=${username}`);
  return openOrders;
};

export const fetchPairOpenOrders = async (username: string, symbol: string): Promise<OrderHistory[]> => {
  const openOrders = await fetchFromAPI<OrderHistory[]>(apiRoot, `/v1/orders/open?limit=250&offset=0&account=${username}&symbol=${symbol}`);
  return openOrders;
};

/**
 * Return history of unopened orders for a given user
 */
export const fetchOrderHistory = async (username: string, limit = 100, offset = 0): Promise<OrderHistory[]> => {
  const orderHistory = await fetchFromAPI<OrderHistory[]>(apiRoot, `/v1/orders/history?limit=${limit}&offset=${offset}&account=${username}`);
  return orderHistory;
};

/**
 * Given a market symbol, return the most recent trades to have executed in that market
 */
export const fetchTrades = async (symbol: string, count = 100, offset = 0): Promise<Trade[]> => {
  const response = await fetchFromAPI<Trade[]>(apiRoot, `/v1/trades/recent?symbol=${symbol}&limit=${count}&offset=${offset}`);
  return response;
};

/**
 * Given a market symbol, get the price for it
 */
export const fetchLatestPrice = async (symbol: string): Promise<number> => {
  const trades = await fetchTrades(symbol, 1);
  return trades[0].price;
};

export interface Balance {
    currency: string;
    amount: number;
    contract: string;
    decimals: number;
}

type TokenBalance = string;
/**
 *
 * @param {string} username - name of proton user/account to retrieve history for
 * @returns {Promise<array>} - array of balances,
 * ex. {"decimals":"4","contract":"eosio.token","amount":"123.4567","currency":"XPR"}
 */
export const fetchBalances = async (username: string): Promise<Balance[]> => {
  const chain = process.env.NODE_ENV === 'test' ? 'protontest' : 'proton';
  const response = await fetchFromAPI<{ balances: Balance[] }>(lightApiRoot, `/balances/${chain}/${username}`, false);
  return response.balances;
};

export const fetchTokenBalance = async (username: string, contractname: string, token: string): Promise<TokenBalance> => {
  const chain = process.env.NODE_ENV === 'test' ? 'protontest' : 'proton';
  const tBalance = await fetchFromAPI<TokenBalance>(lightApiRoot, `/tokenbalance/${chain}/${username}/${contractname}/${token}`, false);
  return tBalance;
};

/**
 * Fetch OHLCV candle data for a symbol
 */
export const fetchOHLCV = async (symbol: string, interval: string, limit = 500, from?: string, to?: string): Promise<OHLCV[]> => {
  let path = `/v1/chart/ohlcv?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  if (from) path += `&from=${from}`;
  if (to) path += `&to=${to}`;
  const data = await fetchFromAPI<OHLCV[]>(apiRoot, path);
  return data;
};

/**
 * Fetch daily summary for all markets
 */
export const fetchDaily = async (): Promise<Daily[]> => {
  const data = await fetchFromAPI<Daily[]>(apiRoot, '/v1/trades/daily');
  return data;
};

/**
 * Fetch leaderboard for given market IDs and time range
 */
export const fetchLeaderboard = async (marketIds: number[], from: string, to: string): Promise<Leaderboard[]> => {
  const ids = marketIds.join(',');
  const data = await fetchFromAPI<Leaderboard[]>(apiRoot, `/v1/leaderboard/list?market_ids=${ids}&from=${from}&to=${to}`);
  return data;
};

/**
 * Fetch transfer history for tokens moving to/from the DEX
 */
export const fetchTransferHistory = async (params: { account?: string; contract?: string; symbol?: string; limit?: number; offset?: number }): Promise<any[]> => {
  const searchParams = new URLSearchParams();
  if (params.account) searchParams.set('account', params.account);
  if (params.contract) searchParams.set('contract', params.contract);
  if (params.symbol) searchParams.set('symbol', params.symbol);
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.offset) searchParams.set('offset', String(params.offset));
  const data = await fetchFromAPI<any[]>(apiRoot, `/history/transfers?${searchParams.toString()}`);
  return data;
};

/**
 * Fetch trade history for a specific account
 */
export const fetchTradeHistory = async (account: string, symbol?: string, limit = 100, offset = 0): Promise<Trade[]> => {
  let path = `/v1/trades/history?account=${account}&limit=${limit}&offset=${offset}`;
  if (symbol) path += `&symbol=${symbol}`;
  const data = await fetchFromAPI<Trade[]>(apiRoot, path);
  return data;
};

/**
 * Get all market symbols from the in-memory cache
 */
export const getAllMarketSymbols = (): string[] => {
  return Array.from(marketsRepo.bySymbol.keys());
};

const marketsRepo: {
  byId: Map<number, Market>;
  bySymbol: Map<string, Market>;
} = {
  byId: new Map(),
  bySymbol: new Map()
};
export const getMarketById = (id: number): Market | undefined => marketsRepo.byId.get(id);
export const getMarketBySymbol = (symbol: string): Market | undefined => marketsRepo.bySymbol.get(symbol);

/**
 * Initialize. Gets and stores all dex markets
 */
export const initialize = async () => {
  // load all markets for later use
  const allMarkets = await fetchMarkets();
  allMarkets.forEach((market) => {
    marketsRepo.byId.set(market.market_id, market);
    marketsRepo.bySymbol.set(market.symbol, market);
  });
};
