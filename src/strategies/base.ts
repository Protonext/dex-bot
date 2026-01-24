import { prepareLimitOrder, submitProcessAction, submitOrders } from "../dexrpc";
import { TradeOrder, TradingStrategy } from "../interfaces";
import * as dexapi from "../dexapi";
import { getUsername } from "../utils";
import { Market } from '@proton/wrap-constants';
import { events } from "../events";

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
}
