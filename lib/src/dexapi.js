import fetch from 'node-fetch';
import { getConfig } from './utils';
// Contains methods for interacting with the off-chain DEX API
const { apiRoot } = getConfig().rpc;
const { lightApiRoot } = getConfig().rpc;
/**
 * Generic GET request to one of the APIs
 */
const fetchFromAPI = async (root, path, returnData = true, times = 3) => {
    try {
        const response = await fetch(`${root}${path}`);
        const responseJson = await response.json();
        if (returnData) {
            return responseJson.data;
        }
        return responseJson;
    }
    catch {
        if (times > 0) {
            times--;
            await fetchFromAPI(root, path, returnData, times);
        }
        else {
            throw new Error(" Not able to reach API server");
        }
    }
    return {};
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
export const fetchMarkets = async () => {
    const marketData = await fetchFromAPI(apiRoot, '/v1/markets/all');
    return marketData;
};
/**
 * Return an orderbook for the provided market. Use a higher step number for low priced currencies
 */
export const fetchOrderBook = async (symbol, limit = 100, step = 100000) => {
    const orderBook = await fetchFromAPI(apiRoot, `/v1/orders/depth?symbol=${symbol}&limit=${limit}&step=${step}`);
    return orderBook;
};
/**
 * Get all open orders for a given user
 * @param {string} username - name of proton user/account to retrieve orders for
 * @returns  {Promise<array>} - list of all open orders
 */
export const fetchOpenOrders = async (username, limit = 250, offset = 0) => {
    const openOrders = await fetchFromAPI(apiRoot, `/v1/orders/open?limit=${limit}&offset=${offset}&account=${username}`);
    return openOrders;
};
export const fetchPairOpenOrders = async (username, symbol) => {
    const openOrders = await fetchFromAPI(apiRoot, `/v1/orders/open?limit=250&offset=0&account=${username}&symbol=${symbol}`);
    return openOrders;
};
/**
 * Return history of unopened orders for a given user
 */
export const fetchOrderHistory = async (username, limit = 100, offset = 0) => {
    const orderHistory = await fetchFromAPI(apiRoot, `/v1/orders/history?limit=${limit}&offset=${offset}&account=${username}`);
    return orderHistory;
};
/**
 * Given a market symbol, return the most recent trades to have executed in that market
 */
export const fetchTrades = async (symbol, count = 100, offset = 0) => {
    const response = await fetchFromAPI(apiRoot, `/v1/trades/recent?symbol=${symbol}&limit=${count}&offset=${offset}`);
    return response;
};
/**
 * Given a market symbol, get the price for it
 */
export const fetchLatestPrice = async (symbol) => {
    const trades = await fetchTrades(symbol, 1);
    return trades[0].price;
};
/**
 *
 * @param {string} username - name of proton user/account to retrieve history for
 * @returns {Promise<array>} - array of balances,
 * ex. {"decimals":"4","contract":"eosio.token","amount":"123.4567","currency":"XPR"}
 */
export const fetchBalances = async (username) => {
    const chain = process.env.NODE_ENV === 'test' ? 'protontest' : 'proton';
    const response = await fetchFromAPI(lightApiRoot, `/balances/${chain}/${username}`, false);
    return response.balances;
};
export const fetchTokenBalance = async (username, contractname, token) => {
    const chain = process.env.NODE_ENV === 'test' ? 'protontest' : 'proton';
    const tBalance = await fetchFromAPI(lightApiRoot, `/tokenbalance/${chain}/${username}/${contractname}/${token}`, false);
    return tBalance;
};
const marketsRepo = {
    byId: new Map(),
    bySymbol: new Map()
};
export const getMarketById = (id) => marketsRepo.byId.get(id);
export const getMarketBySymbol = (symbol) => marketsRepo.bySymbol.get(symbol);
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
//# sourceMappingURL=dexapi.js.map