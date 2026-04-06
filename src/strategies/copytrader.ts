import { BigNumber as BN } from 'bignumber.js';
import { ORDERSIDES } from '../core/constants';
import { BotConfig, CopyTraderConfig, TradeOrder, TrackedOrder } from '../interfaces';
import { getLogger } from '../utils';
import { TradingStrategyBase, OrderStateEntry } from './base';
import { events } from '../events';

const logger = getLogger();

/**
 * Copy Trader Strategy
 * Monitors target accounts' trade history and mirrors their trades
 * at a configurable percentage of their size.
 */
export class CopyTraderStrategy extends TradingStrategyBase {
  private config!: CopyTraderConfig;
  private seenTradeIds: Set<string> = new Set();
  private trackedOrders: TrackedOrder[] = [];

  async initialize(options?: BotConfig['copyTrader']): Promise<void> {
    if (!options) throw new Error('CopyTrader config is required');
    this.config = options;

    const persisted = this.loadTrackedOrders();
    if (persisted.length > 0) {
      this.trackedOrders = persisted;
      // Recover seen trade IDs from persisted metadata
      for (const order of persisted) {
        if ((order as any)._sourceTradeId) {
          this.seenTradeIds.add((order as any)._sourceTradeId);
        }
      }
      logger.info(`[CopyTrader] Recovered ${persisted.length} tracked orders, ${this.seenTradeIds.size} seen trades`);
    }
  }

  async trade(): Promise<void> {
    const { targetAccounts, symbol, copyPct, maxOrderAmount } = this.config;

    try {
      const newOrders: (TradeOrder & { _sourceTradeId: string })[] = [];

      for (const target of targetAccounts) {
        // Fetch recent trade history for target
        const trades = await this.dexAPI.fetchTradeHistory(target, symbol, 50, 0);

        for (const trade of trades) {
          if (this.seenTradeIds.has(trade.trade_id)) continue;
          this.seenTradeIds.add(trade.trade_id);

          // Determine the trade's market symbol
          const market = this.dexAPI.getMarketById(trade.market_id);
          if (!market) continue;

          const bidPrecision = market.bid_token.precision;
          const askPrecision = market.ask_token.precision;

          // Determine side: if target is bid_user, they bought; if ask_user, they sold
          let side: ORDERSIDES;
          let tradeAmount: number;

          if (trade.bid_user === target) {
            side = ORDERSIDES.BUY;
            tradeAmount = trade.bid_total;
          } else if (trade.ask_user === target) {
            side = ORDERSIDES.SELL;
            tradeAmount = trade.ask_total;
          } else {
            continue;
          }

          // Calculate copy amount (capped)
          const copyAmount = Math.min(tradeAmount * copyPct, maxOrderAmount);
          if (copyAmount <= 0) continue;

          const price = new BN(trade.price).toFixed(askPrecision);
          const quantity = +new BN(copyAmount).dividedBy(price).toFixed(bidPrecision);

          if (quantity <= 0) continue;

          const order: TradeOrder & { _sourceTradeId: string } = {
            orderSide: side,
            price: +price,
            quantity,
            marketSymbol: market.symbol,
            _sourceTradeId: trade.trade_id,
          };

          newOrders.push(order);
          const sideStr = side === ORDERSIDES.BUY ? 'BUY' : 'SELL';
          logger.info(`[CopyTrader] Copying ${target}'s ${sideStr} on ${market.symbol}: ${quantity} @ ${price}`);
        }
      }

      // Place copy orders
      if (newOrders.length > 0) {
        const tradeOrders: TradeOrder[] = newOrders.map(({ _sourceTradeId, ...order }) => order);
        await this.placeOrders(tradeOrders);

        // Resolve by symbol groups
        const bySymbol = new Map<string, TradeOrder[]>();
        for (const order of tradeOrders) {
          const group = bySymbol.get(order.marketSymbol) || [];
          group.push(order);
          bySymbol.set(order.marketSymbol, group);
        }

        for (const [sym, orders] of bySymbol) {
          const resolved = await this.resolveOrderIds(orders, sym);
          this.trackedOrders.push(...resolved);
        }

        events.orderPlaced(`[CopyTrader] Placed ${newOrders.length} copy orders`, {
          count: newOrders.length,
        });
      }

      // Write order state
      const symbolGroups = new Map<string, TrackedOrder[]>();
      for (const order of this.trackedOrders) {
        const group = symbolGroups.get(order.marketSymbol) || [];
        group.push(order);
        symbolGroups.set(order.marketSymbol, group);
      }

      const orderStateEntries: OrderStateEntry[] = [];
      for (const [sym, orders] of symbolGroups) {
        const trackedIds = new Set(orders.map(o => o.orderId).filter((id): id is string => !!id));
        const openOrders = await this.getOwnOpenOrders(sym, trackedIds);
        orderStateEntries.push({
          symbol: sym,
          orders: openOrders,
          expectedOrders: orders.length,
        });
      }
      this.writeOrderState(orderStateEntries);

    } catch (error) {
      const errorMsg = (error as Error).message;
      logger.error(`[CopyTrader] Error: ${errorMsg}`);
      events.botError(`CopyTrader error: ${errorMsg}`, { error: errorMsg });
    }

    this.persistTrackedOrders();
  }

  async cancelOwnOrders(): Promise<void> {
    if (this.trackedOrders.length > 0) {
      logger.info(`[CopyTrader] Cancelling ${this.trackedOrders.length} tracked orders`);
      await this.cancelTrackedOrders(this.trackedOrders);
    }
    this.cleanupTrackedOrdersFile();
  }

  private persistTrackedOrders(): void {
    this.saveTrackedOrders('copytrader', this.trackedOrders);
  }
}
