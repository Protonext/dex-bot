import { BigNumber as BN } from 'bignumber.js';
import { ORDERSIDES } from '../core/constants';
import { BotConfig, WhaleWatcherConfig, TradeOrder, TrackedOrder } from '../interfaces';
import { getLogger } from '../utils';
import { TradingStrategyBase, OrderStateEntry } from './base';
import { events } from '../events';

const logger = getLogger();

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Whale Watcher / Flow Bot Strategy
 * Monitors large token transfers to the DEX.
 * Large inflows suggest sell pressure → places BUY orders below market to catch the dip.
 */
export class WhaleWatcherStrategy extends TradingStrategyBase {
  private config!: WhaleWatcherConfig;
  private lastCheckTimestamp: string = new Date().toISOString();
  private trackedOrders: TrackedOrder[] = [];

  async initialize(options?: BotConfig['whaleWatcher']): Promise<void> {
    if (!options) throw new Error('WhaleWatcher config is required');
    this.config = options;

    const persisted = this.loadTrackedOrders();
    if (persisted.length > 0) {
      this.trackedOrders = persisted;
      if ((persisted[0] as any)._lastCheck) {
        this.lastCheckTimestamp = (persisted[0] as any)._lastCheck;
      }
      logger.info(`[WhaleWatcher] Recovered ${persisted.length} tracked orders`);
    }
  }

  async trade(): Promise<void> {
    const { watchTokens, minTransferAmount, symbol, orderAmount, actionDelay } = this.config;

    try {
      const market = this.dexAPI.getMarketBySymbol(symbol);
      if (!market) {
        logger.error(`[WhaleWatcher] Invalid market: ${symbol}`);
        return;
      }

      const bidPrecision = market.bid_token.precision;
      const askPrecision = market.ask_token.precision;

      // 1. Clean up filled orders
      const trackedIds = new Set(
        this.trackedOrders.map(o => o.orderId).filter((id): id is string => !!id)
      );
      const openOrders = await this.getOwnOpenOrders(symbol, trackedIds);
      const openIds = new Set(openOrders.map(o => o.order_id));

      // Remove orders that are no longer open (either filled or expired)
      const stillActive: TrackedOrder[] = [];
      for (const tracked of this.trackedOrders) {
        if (tracked.orderId && openIds.has(tracked.orderId)) {
          stillActive.push(tracked);
        } else if (tracked.orderId) {
          logger.info(`[WhaleWatcher] Order ${tracked.orderId} no longer open`);
          events.orderFilled(`[WhaleWatcher] Order filled/expired`, {
            market: symbol, price: tracked.price,
          });
        }
      }
      this.trackedOrders = stillActive;

      // 2. Check transfers for each watched token
      let newOrdersPlaced = false;
      for (const token of watchTokens) {
        const transfers = await this.dexAPI.fetchTransferHistory({
          symbol: token,
          limit: 50,
        });

        if (!transfers || !Array.isArray(transfers)) continue;

        // Filter for large, recent transfers
        const largeTransfers = transfers.filter((t: any) => {
          const amount = parseFloat(t.amount || t.quantity || '0');
          const timestamp = t.timestamp || t.block_time || '';
          return amount >= minTransferAmount && timestamp > this.lastCheckTimestamp;
        });

        if (largeTransfers.length === 0) continue;

        logger.info(`[WhaleWatcher] Detected ${largeTransfers.length} large ${token} transfers`);

        // 3. Apply action delay
        if (actionDelay > 0) {
          await delay(actionDelay);
        }

        // 4. Place BUY orders below market (expecting sell pressure dip)
        const currentPrice = await this.dexAPI.fetchLatestPrice(symbol);
        const dipPrice = new BN(currentPrice).times(0.98).toFixed(askPrecision); // 2% below market
        const quantity = +new BN(orderAmount).dividedBy(dipPrice).toFixed(bidPrecision);

        const order: TradeOrder = {
          orderSide: ORDERSIDES.BUY,
          price: +dipPrice,
          quantity,
          marketSymbol: symbol,
        };

        await this.placeOrders([order]);
        const [resolved] = await this.resolveOrderIds([order], symbol);
        this.trackedOrders.push(resolved);
        newOrdersPlaced = true;

        logger.info(`[WhaleWatcher] Placed BUY at ${dipPrice} (${token} whale inflow detected)`);
        events.orderPlaced(`[WhaleWatcher] BUY at ${dipPrice} after whale ${token} inflow`, {
          market: symbol, token, transferCount: largeTransfers.length,
        });
      }

      // Update timestamp
      this.lastCheckTimestamp = new Date().toISOString();

      // Write order state
      const orderStateEntries: OrderStateEntry[] = [{
        symbol,
        orders: openOrders,
        expectedOrders: this.trackedOrders.length,
      }];
      this.writeOrderState(orderStateEntries);

    } catch (error) {
      const errorMsg = (error as Error).message;
      logger.error(`[WhaleWatcher] Error: ${errorMsg}`);
      events.botError(`WhaleWatcher error: ${errorMsg}`, { error: errorMsg });
    }

    this.persistTrackedOrders();
  }

  async cancelOwnOrders(): Promise<void> {
    if (this.trackedOrders.length > 0) {
      logger.info(`[WhaleWatcher] Cancelling ${this.trackedOrders.length} tracked orders`);
      await this.cancelTrackedOrders(this.trackedOrders);
    }
    this.cleanupTrackedOrdersFile();
  }

  private persistTrackedOrders(): void {
    const ordersWithMeta = this.trackedOrders.map((o, i) => ({
      ...o,
      ...(i === 0 ? { _lastCheck: this.lastCheckTimestamp } : {}),
    }));
    this.saveTrackedOrders('whalewatcher', ordersWithMeta as TrackedOrder[]);
  }
}
