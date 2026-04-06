import { BigNumber as BN } from 'bignumber.js';
import { ORDERSIDES } from '../core/constants';
import { BotConfig, ArbBotConfig, TradeOrder, TrackedOrder } from '../interfaces';
import { getLogger } from '../utils';
import { TradingStrategyBase, OrderStateEntry } from './base';
import { events } from '../events';

const logger = getLogger();

/**
 * Cross-Pair Arbitrage Bot Strategy
 * Monitors 3 pairs forming a triangle and executes when a profitable
 * cross-rate discrepancy is detected.
 *
 * Example triangle: XPR_XMD, XBTC_XMD, XPR_XBTC
 * Direct: buy XPR with XMD
 * Implied: buy XBTC with XMD, then buy XPR with XBTC
 */
export class ArbBotStrategy extends TradingStrategyBase {
  private config!: ArbBotConfig;
  private trackedOrders: TrackedOrder[] = [];

  async initialize(options?: BotConfig['arbBot']): Promise<void> {
    if (!options) throw new Error('ArbBot config is required');
    if (options.pairs.length !== 3) throw new Error('ArbBot requires exactly 3 pairs');
    this.config = options;

    const persisted = this.loadTrackedOrders();
    if (persisted.length > 0) {
      this.trackedOrders = persisted;
      logger.info(`[ArbBot] Recovered ${persisted.length} tracked orders`);
    }
  }

  async trade(): Promise<void> {
    const { pairs, minProfitPct, orderAmount } = this.config;

    try {
      // 1. Fetch orderbooks for all 3 pairs
      const books = await Promise.all(
        pairs.map(async (pair) => {
          const book = await this.dexAPI.fetchOrderBook(pair, 5);
          return { pair, book };
        })
      );

      // Validate all books have data
      for (const { pair, book } of books) {
        if (!book.bids.length || !book.asks.length) {
          logger.warn(`[ArbBot] ${pair} orderbook is empty - skipping`);
          return;
        }
      }

      // 2. Extract best prices
      const prices = books.map(({ pair, book }) => ({
        pair,
        bestBid: book.bids[0].level,
        bestAsk: book.asks[0].level,
      }));

      // 3. Check forward triangle: buy A→B, buy B→C, sell A→C
      const [p0, p1, p2] = prices;

      // Forward path: buy pair0 (pay ask), buy pair1 (pay ask), sell pair2 (get bid)
      const forwardCost = p0.bestAsk * p1.bestAsk;
      const forwardRevenue = p2.bestBid;
      const forwardProfit = forwardRevenue > 0
        ? ((forwardRevenue - forwardCost) / forwardCost) * 100
        : -100;

      // Reverse path: sell pair0 (get bid), sell pair1 (get bid), buy pair2 (pay ask)
      const reverseCost = p2.bestAsk;
      const reverseRevenue = p0.bestBid * p1.bestBid;
      const reverseProfit = reverseCost > 0
        ? ((reverseRevenue - reverseCost) / reverseCost) * 100
        : -100;

      logger.info(`[ArbBot] Forward profit: ${forwardProfit.toFixed(4)}%, Reverse profit: ${reverseProfit.toFixed(4)}%`);

      // 4. Execute if profitable
      if (forwardProfit > minProfitPct) {
        logger.info(`[ArbBot] Forward arb opportunity: ${forwardProfit.toFixed(4)}%`);
        await this.executeTriangle(pairs, 'forward', orderAmount);
      } else if (reverseProfit > minProfitPct) {
        logger.info(`[ArbBot] Reverse arb opportunity: ${reverseProfit.toFixed(4)}%`);
        await this.executeTriangle(pairs, 'reverse', orderAmount);
      } else {
        logger.info(`[ArbBot] No arb opportunity (min: ${minProfitPct}%)`);
      }

      // Write order state
      const orderStateEntries: OrderStateEntry[] = [];
      for (const pair of pairs) {
        const market = this.dexAPI.getMarketBySymbol(pair);
        if (!market) continue;
        const pairOrders = this.trackedOrders.filter(o => o.marketSymbol === pair);
        const trackedIds = new Set(pairOrders.map(o => o.orderId).filter((id): id is string => !!id));
        if (trackedIds.size > 0) {
          const openOrders = await this.getOwnOpenOrders(pair, trackedIds);
          orderStateEntries.push({ symbol: pair, orders: openOrders, expectedOrders: pairOrders.length });
        }
      }
      if (orderStateEntries.length > 0) {
        this.writeOrderState(orderStateEntries);
      }

    } catch (error) {
      const errorMsg = (error as Error).message;
      logger.error(`[ArbBot] Error: ${errorMsg}`);
      events.botError(`ArbBot error: ${errorMsg}`, { error: errorMsg });
    }

    this.persistTrackedOrders();
  }

  private async executeTriangle(pairs: [string, string, string], direction: 'forward' | 'reverse', amount: number): Promise<void> {
    const orders: TradeOrder[] = [];

    for (let i = 0; i < 3; i++) {
      const pair = pairs[i];
      const market = this.dexAPI.getMarketBySymbol(pair);
      if (!market) {
        logger.error(`[ArbBot] Invalid market: ${pair}`);
        return;
      }

      const bidPrecision = market.bid_token.precision;
      const askPrecision = market.ask_token.precision;
      const currentPrice = await this.dexAPI.fetchLatestPrice(pair);
      const price = new BN(currentPrice).toFixed(askPrecision);

      let side: ORDERSIDES;
      if (direction === 'forward') {
        side = i < 2 ? ORDERSIDES.BUY : ORDERSIDES.SELL;
      } else {
        side = i < 2 ? ORDERSIDES.SELL : ORDERSIDES.BUY;
      }

      const quantity = +new BN(amount).dividedBy(price).toFixed(bidPrecision);

      orders.push({
        orderSide: side,
        price: +price,
        quantity,
        marketSymbol: pair,
      });
    }

    // Execute all 3 legs
    await this.placeOrders(orders);

    for (const order of orders) {
      const [resolved] = await this.resolveOrderIds([order], order.marketSymbol);
      this.trackedOrders.push(resolved);
    }

    events.tradeExecuted(`[ArbBot] ${direction} triangle executed`, {
      pairs,
      direction,
      amount,
    });
  }

  async cancelOwnOrders(): Promise<void> {
    if (this.trackedOrders.length > 0) {
      logger.info(`[ArbBot] Cancelling ${this.trackedOrders.length} tracked orders`);
      await this.cancelTrackedOrders(this.trackedOrders);
    }
    this.cleanupTrackedOrdersFile();
  }

  private persistTrackedOrders(): void {
    this.saveTrackedOrders('arbbot', this.trackedOrders);
  }
}
