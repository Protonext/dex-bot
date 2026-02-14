import { prepareLimitOrder, submitProcessAction, submitOrders } from "../dexrpc";
import { TradeOrder, TradingStrategy } from "../interfaces";
import * as dexapi from "../dexapi";
import { getConfig, getUsername } from "../utils";
import { Market, OrderHistory } from '@proton/wrap-constants';
import { ORDERSIDES } from '../core/constants';
import { events } from "../events";
import fs from 'fs';
import path from 'path';

export interface OrderStateEntry {
  symbol: string;
  orders: OrderHistory[];
  expectedOrders: number;
}

export interface MarketDetails {
  highestBid: number;
  lowestAsk: number;
  market?: Market;
  price: number;
}

function delay(ms: number) {
  return new Promise( resolve => setTimeout(resolve, ms) );
}

export abstract class TradingStrategyBase implements TradingStrategy {
  abstract initialize(options?: any): Promise<void>;

  abstract trade(): Promise<void>;

  protected dexAPI = dexapi;
  protected username = getUsername();

  protected async placeOrders(orders: TradeOrder[], delayTime = 2000): Promise<void> {
    for(var i = 1; i <= orders.length; i++) {
        const order = orders[i-1];
        await prepareLimitOrder(
          order.marketSymbol,
          order.orderSide,
          order.quantity,
          order.price
      );
      if(i%10 === 0 || i === orders.length) {
        await submitProcessAction();
        await submitOrders();

        // Emit event for batch of orders placed
        const batchStart = Math.floor((i - 1) / 10) * 10;
        const batchOrders = orders.slice(batchStart, i);
        events.gridPlaced(`Placed ${batchOrders.length} orders`, {
          orders: batchOrders.map(o => ({
            market: o.marketSymbol,
            side: o.orderSide === 1 ? 'BUY' : 'SELL',
            quantity: o.quantity,
            price: o.price,
          })),
        });

        await delay(delayTime);
      };
    }
  }

  protected async getOpenOrders(marketSymbol: string) {
    const market = this.dexAPI.getMarketBySymbol(marketSymbol);
    if (market === undefined) {
      throw new Error(`Market ${marketSymbol} does not exist`);
    }

    const allOrders = await this.dexAPI.fetchPairOpenOrders(this.username, marketSymbol);
    console.log(`Open orders size for pair ${marketSymbol} ${allOrders.length}`);
    return allOrders;
  }

  protected async getMarketDetails(marketSymbol: string): Promise<MarketDetails> {
    const market = dexapi.getMarketBySymbol(marketSymbol);
    const price = await dexapi.fetchLatestPrice(marketSymbol);
    const orderBook = await dexapi.fetchOrderBook(marketSymbol, 1);
    const lowestAsk =
      orderBook.asks.length > 0 ? orderBook.asks[0].level : price;
    const highestBid =
      orderBook.bids.length > 0 ? orderBook.bids[0].level : price;

    const details = {
      highestBid,
      lowestAsk,
      market,
      price,
    };

    return details;
  }

  protected writeOrderState(entries: OrderStateEntry[]): void {
    const stateDir = process.env.ORDER_STATE_DIR;
    const instanceId = process.env.DASHBOARD_INSTANCE_ID;
    if (!stateDir || !instanceId) return;

    try {
      if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
      }

      const markets = entries.map(entry => {
        const market = this.dexAPI.getMarketBySymbol(entry.symbol);
        const buyOrders = entry.orders.filter(o => o.order_side === ORDERSIDES.BUY);
        const sellOrders = entry.orders.filter(o => o.order_side === ORDERSIDES.SELL);
        return {
          symbol: entry.symbol,
          marketId: market?.market_id || 0,
          bidToken: market?.bid_token?.code || '',
          askToken: market?.ask_token?.code || '',
          buyOrders,
          sellOrders,
          totalOrders: entry.orders.length,
          expectedOrders: entry.expectedOrders,
        };
      });

      const state = {
        instanceId,
        timestamp: new Date().toISOString(),
        username: this.username,
        strategy: getConfig().strategy,
        network: process.env.NODE_ENV === 'test' ? 'testnet' : 'mainnet',
        totalOpenOrders: entries.reduce((sum, e) => sum + e.orders.length, 0),
        markets,
      };

      const filePath = path.join(stateDir, `${instanceId}-orders.json`);
      const tempPath = filePath + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(state));
      fs.renameSync(tempPath, filePath);
    } catch (error) {
      console.warn('Failed to write order state:', error);
    }
  }
}
