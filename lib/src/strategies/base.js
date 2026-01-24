import { prepareLimitOrder, submitProcessAction, submitOrders } from "../dexrpc";
import * as dexapi from "../dexapi";
import { getUsername } from "../utils";
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
export class TradingStrategyBase {
    dexAPI = dexapi;
    username = getUsername();
    async placeOrders(orders, delayTime = 2000) {
        for (var i = 1; i <= orders.length; i++) {
            await prepareLimitOrder(orders[i - 1].marketSymbol, orders[i - 1].orderSide, orders[i - 1].quantity, orders[i - 1].price);
            if (i % 10 === 0 || i === orders.length) {
                await submitProcessAction();
                await submitOrders();
                await delay(delayTime);
            }
            ;
        }
    }
    async getOpenOrders(marketSymbol) {
        const market = this.dexAPI.getMarketBySymbol(marketSymbol);
        if (market === undefined) {
            throw new Error(`Market ${marketSymbol} does not exist`);
        }
        const allOrders = await this.dexAPI.fetchPairOpenOrders(this.username, marketSymbol);
        console.log(`Open orders size for pair ${marketSymbol} ${allOrders.length}`);
        return allOrders;
    }
    async getMarketDetails(marketSymbol) {
        const market = dexapi.getMarketBySymbol(marketSymbol);
        const price = await dexapi.fetchLatestPrice(marketSymbol);
        const orderBook = await dexapi.fetchOrderBook(marketSymbol, 1);
        const lowestAsk = orderBook.asks.length > 0 ? orderBook.asks[0].level : price;
        const highestBid = orderBook.bids.length > 0 ? orderBook.bids[0].level : price;
        const details = {
            highestBid,
            lowestAsk,
            market,
            price,
        };
        return details;
    }
}
//# sourceMappingURL=base.js.map