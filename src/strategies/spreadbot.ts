import { BigNumber as BN } from 'bignumber.js';
import { Depth } from '@proton/wrap-constants';
import { ORDERSIDES } from '../core/constants';
import { BotConfig, SpreadBotConfig, TradeOrder, TrackedOrder } from '../interfaces';
import { getLogger } from '../utils';
import { TradingStrategyBase, OrderStateEntry } from './base';
import { events } from '../events';

const logger = getLogger();

/**
 * Spread Capture / Smart Market Making Strategy
 * Adapts to orderbook shape with dynamic spread capture.
 * Unlike the basic marketMaker, this strategy:
 * - Analyzes orderbook depth to size orders appropriately
 * - Only places orders when spread is within target range
 * - Rebalances when orders drift beyond threshold
 */
export class SpreadBotStrategy extends TradingStrategyBase {
  private config!: SpreadBotConfig;
  private buyOrder: TrackedOrder | null = null;
  private sellOrder: TrackedOrder | null = null;

  async initialize(options?: BotConfig['spreadBot']): Promise<void> {
    if (!options) throw new Error('SpreadBot config is required');
    this.config = options;

    const persisted = this.loadTrackedOrders();
    if (persisted.length > 0) {
      for (const order of persisted) {
        if (order.orderSide === ORDERSIDES.BUY) this.buyOrder = order;
        else this.sellOrder = order;
      }
      logger.info(`[SpreadBot] Recovered ${persisted.length} tracked orders`);
    }
  }

  async trade(): Promise<void> {
    const { symbol, maxSpreadPct, minSpreadPct, orderAmount, depthLevels, rebalanceThresholdPct } = this.config;

    try {
      const market = this.dexAPI.getMarketBySymbol(symbol);
      if (!market) {
        logger.error(`[SpreadBot] Invalid market: ${symbol}`);
        return;
      }

      const bidPrecision = market.bid_token.precision;
      const askPrecision = market.ask_token.precision;

      // 1. Fetch orderbook
      const orderBook = await this.dexAPI.fetchOrderBook(symbol, depthLevels);
      if (!orderBook.bids.length || !orderBook.asks.length) {
        logger.warn(`[SpreadBot] ${symbol} orderbook is empty`);
        return;
      }

      const highestBid = orderBook.bids[0].level;
      const lowestAsk = orderBook.asks[0].level;
      const midPrice = (highestBid + lowestAsk) / 2;
      const spreadPct = ((lowestAsk - highestBid) / midPrice) * 100;

      logger.info(`[SpreadBot] ${symbol} Spread: ${spreadPct.toFixed(3)}% (bid: ${highestBid}, ask: ${lowestAsk})`);

      // 2. Check if we need to rebalance existing orders
      if (this.buyOrder || this.sellOrder) {
        const trackedIds = new Set<string>(
          [this.buyOrder?.orderId, this.sellOrder?.orderId].filter((id): id is string => !!id)
        );
        const openOrders = await this.getOwnOpenOrders(symbol, trackedIds);
        const openIds = new Set(openOrders.map(o => o.order_id));

        // Check for fills
        if (this.buyOrder?.orderId && !openIds.has(this.buyOrder.orderId)) {
          logger.info(`[SpreadBot] Buy order filled at ${this.buyOrder.price}`);
          events.orderFilled(`[SpreadBot] BUY filled at ${this.buyOrder.price}`, { market: symbol });
          this.buyOrder = null;
        }
        if (this.sellOrder?.orderId && !openIds.has(this.sellOrder.orderId)) {
          logger.info(`[SpreadBot] Sell order filled at ${this.sellOrder.price}`);
          events.orderFilled(`[SpreadBot] SELL filled at ${this.sellOrder.price}`, { market: symbol });
          this.sellOrder = null;
        }

        // Check drift for remaining orders
        let needsRebalance = false;
        if (this.buyOrder) {
          const drift = Math.abs(this.buyOrder.price - highestBid) / midPrice * 100;
          if (drift > rebalanceThresholdPct) {
            needsRebalance = true;
            logger.info(`[SpreadBot] Buy order drifted ${drift.toFixed(2)}% - rebalancing`);
          }
        }
        if (this.sellOrder) {
          const drift = Math.abs(this.sellOrder.price - lowestAsk) / midPrice * 100;
          if (drift > rebalanceThresholdPct) {
            needsRebalance = true;
            logger.info(`[SpreadBot] Sell order drifted ${drift.toFixed(2)}% - rebalancing`);
          }
        }

        if (needsRebalance) {
          // Cancel existing orders and re-place
          const toCancel = [this.buyOrder, this.sellOrder].filter((o): o is TrackedOrder => !!o);
          await this.cancelTrackedOrders(toCancel);
          this.buyOrder = null;
          this.sellOrder = null;
        }
      }

      // 3. Place new orders if spread is in range
      if (spreadPct < minSpreadPct) {
        logger.info(`[SpreadBot] Spread ${spreadPct.toFixed(3)}% below minimum ${minSpreadPct}% - skipping`);
      } else if (spreadPct > maxSpreadPct) {
        logger.info(`[SpreadBot] Spread ${spreadPct.toFixed(3)}% above maximum ${maxSpreadPct}% - skipping`);
      } else {
        // Calculate depth-aware order sizing
        const depthFactor = this.calculateDepthFactor(orderBook.bids, orderBook.asks, depthLevels);
        const adjustedAmount = new BN(orderAmount).times(depthFactor);

        const newOrders: TradeOrder[] = [];

        if (!this.buyOrder) {
          // Place buy just inside the spread
          const offset = new BN(lowestAsk - highestBid).times(0.1); // 10% into the spread
          const buyPrice = new BN(highestBid).plus(offset).toFixed(askPrecision);
          const quantity = +adjustedAmount.dividedBy(buyPrice).toFixed(bidPrecision);
          newOrders.push({
            orderSide: ORDERSIDES.BUY,
            price: +buyPrice,
            quantity,
            marketSymbol: symbol,
          });
        }

        if (!this.sellOrder) {
          const offset = new BN(lowestAsk - highestBid).times(0.1);
          const sellPrice = new BN(lowestAsk).minus(offset).toFixed(askPrecision);
          const quantity = +adjustedAmount.dividedBy(sellPrice).toFixed(bidPrecision);
          newOrders.push({
            orderSide: ORDERSIDES.SELL,
            price: +sellPrice,
            quantity,
            marketSymbol: symbol,
          });
        }

        if (newOrders.length > 0) {
          await this.placeOrders(newOrders);
          const resolved = await this.resolveOrderIds(newOrders, symbol);
          for (const order of resolved) {
            if (order.orderSide === ORDERSIDES.BUY) this.buyOrder = order;
            else this.sellOrder = order;
          }
          events.orderPlaced(`[SpreadBot] Placed ${newOrders.length} orders, spread: ${spreadPct.toFixed(3)}%`, {
            market: symbol, spread: spreadPct,
          });
        }
      }

      // Write order state
      const trackedIds = new Set<string>(
        [this.buyOrder?.orderId, this.sellOrder?.orderId].filter((id): id is string => !!id)
      );
      const currentOrders = await this.getOwnOpenOrders(symbol, trackedIds);
      this.writeOrderState([{
        symbol,
        orders: currentOrders,
        expectedOrders: (this.buyOrder ? 1 : 0) + (this.sellOrder ? 1 : 0),
      }]);

    } catch (error) {
      const errorMsg = (error as Error).message;
      logger.error(`[SpreadBot] Error: ${errorMsg}`);
      events.botError(`SpreadBot error: ${errorMsg}`, { error: errorMsg });
    }

    this.persistTrackedOrders();
  }

  async cancelOwnOrders(): Promise<void> {
    const toCancel = [this.buyOrder, this.sellOrder].filter((o): o is TrackedOrder => !!o);
    if (toCancel.length > 0) {
      logger.info(`[SpreadBot] Cancelling ${toCancel.length} tracked orders`);
      await this.cancelTrackedOrders(toCancel);
    }
    this.cleanupTrackedOrdersFile();
  }

  /**
   * Calculate a sizing factor based on orderbook depth.
   * Thinner depth = smaller factor (smaller orders).
   */
  private calculateDepthFactor(bids: Depth[], asks: Depth[], levels: number): number {
    const bidDepth = bids.slice(0, levels).reduce((sum, b) => sum + b.bid, 0);
    const askDepth = asks.slice(0, levels).reduce((sum, a) => sum + a.ask, 0);
    const avgDepth = (bidDepth + askDepth) / 2;

    // Normalize: if depth is very thin, reduce to 50%
    if (avgDepth <= 0) return 0.5;
    return Math.min(1.0, Math.max(0.5, avgDepth / (avgDepth + 1000)));
  }

  private persistTrackedOrders(): void {
    const all = [this.buyOrder, this.sellOrder].filter((o): o is TrackedOrder => !!o);
    this.saveTrackedOrders('spreadbot', all);
  }
}
