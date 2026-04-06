import { BigNumber as BN } from 'bignumber.js';
import { ORDERSIDES } from '../core/constants';
import { BotConfig, TWAPBotConfig, TradeOrder, TrackedOrder } from '../interfaces';
import { getLogger } from '../utils';
import { TradingStrategyBase, OrderStateEntry } from './base';
import { events } from '../events';
import { volatility } from '../utils/indicators';

const logger = getLogger();

/**
 * TWAP (Time-Weighted Average Price) Bot Strategy
 * Executes a large order by splitting it into equal slices over time.
 * Optionally skips slices during high-volatility periods.
 */
export class TWAPBotStrategy extends TradingStrategyBase {
  private config!: TWAPBotConfig;
  private slicesExecuted = 0;
  private referencePrice = 0;
  private startTime = 0;
  private trackedOrders: TrackedOrder[] = [];

  async initialize(options?: BotConfig['twapBot']): Promise<void> {
    if (!options) throw new Error('TWAPBot config is required');
    this.config = options;
    this.startTime = Date.now();

    const persisted = this.loadTrackedOrders();
    if (persisted.length > 0) {
      this.trackedOrders = persisted;
      this.slicesExecuted = (persisted[0] as any)?._slicesExecuted ?? persisted.length;
      this.referencePrice = (persisted[0] as any)?._referencePrice ?? 0;
      this.startTime = (persisted[0] as any)?._startTime ?? Date.now();
      logger.info(`[TWAPBot] Recovered state: ${this.slicesExecuted}/${this.config.sliceCount} slices executed`);
    }
  }

  async trade(): Promise<void> {
    const { symbol, side, totalAmount, durationMinutes, sliceCount, maxSlippage, avoidHighVolatility } = this.config;

    try {
      // Check if all slices completed
      if (this.slicesExecuted >= sliceCount) {
        logger.info(`[TWAPBot] All ${sliceCount} slices executed. TWAP complete.`);
        return;
      }

      const market = this.dexAPI.getMarketBySymbol(symbol);
      if (!market) {
        logger.error(`[TWAPBot] Invalid market: ${symbol}`);
        return;
      }

      const bidPrecision = market.bid_token.precision;
      const askPrecision = market.ask_token.precision;

      // Calculate timing — first slice executes immediately, then at intervals
      const sliceIntervalMs = (durationMinutes * 60 * 1000) / sliceCount;
      const elapsed = Date.now() - this.startTime;
      const expectedSlices = Math.min(sliceCount, Math.floor(elapsed / sliceIntervalMs) + 1);

      // Not time for next slice yet
      if (this.slicesExecuted >= expectedSlices) {
        logger.info(`[TWAPBot] Waiting for next slice (${this.slicesExecuted}/${sliceCount}, next at ${new Date(this.startTime + (this.slicesExecuted + 1) * sliceIntervalMs).toISOString()})`);
        return;
      }

      // Get current price
      const currentPrice = await this.dexAPI.fetchLatestPrice(symbol);

      // Set reference price on first trade
      if (this.referencePrice === 0) {
        this.referencePrice = currentPrice;
      }

      // Check slippage
      const slippagePct = Math.abs(currentPrice - this.referencePrice) / this.referencePrice * 100;
      if (slippagePct > maxSlippage) {
        logger.warn(`[TWAPBot] Slippage ${slippagePct.toFixed(2)}% exceeds max ${maxSlippage}% - skipping slice`);
        return;
      }

      // Check volatility if configured
      if (avoidHighVolatility) {
        const candles = await this.dexAPI.fetchOHLCV(symbol, '15m', 20);
        if (candles.length >= 2) {
          const vol = volatility(candles);
          if (vol > 0.05) { // 5% standard deviation threshold
            logger.warn(`[TWAPBot] High volatility detected (${(vol * 100).toFixed(2)}%) - skipping slice`);
            return;
          }
        }
      }

      // Calculate slice amount
      const amountPerSlice = totalAmount / sliceCount;
      const orderSide = side === 'BUY' ? ORDERSIDES.BUY : ORDERSIDES.SELL;

      const price = new BN(currentPrice).toFixed(askPrecision);
      let quantity: number;

      if (orderSide === ORDERSIDES.BUY) {
        // For buys, amountPerSlice is in quote currency
        quantity = +new BN(amountPerSlice).dividedBy(price).toFixed(bidPrecision);
      } else {
        // For sells, amountPerSlice is in base currency
        quantity = +new BN(amountPerSlice).toFixed(bidPrecision);
      }

      const order: TradeOrder = {
        orderSide,
        price: +price,
        quantity,
        marketSymbol: symbol,
      };

      await this.placeOrders([order]);
      const [resolved] = await this.resolveOrderIds([order], symbol);
      this.trackedOrders.push(resolved);
      this.slicesExecuted++;

      const sideStr = side;
      logger.info(`[TWAPBot] Slice ${this.slicesExecuted}/${sliceCount}: ${sideStr} ${quantity} @ ${price} on ${symbol}`);
      events.tradeExecuted(`[TWAPBot] Slice ${this.slicesExecuted}/${sliceCount}`, {
        market: symbol,
        side: sideStr,
        quantity,
        price: +price,
        slicesExecuted: this.slicesExecuted,
        sliceCount,
      });

      if (this.slicesExecuted >= sliceCount) {
        logger.info(`[TWAPBot] TWAP execution complete! All ${sliceCount} slices executed.`);
        events.custom('system', 'bot_stopped', 'success', `[TWAPBot] TWAP complete for ${symbol}`);
      }

      // Write order state
      const trackedIds = new Set(
        this.trackedOrders.map(o => o.orderId).filter((id): id is string => !!id)
      );
      const openOrders = await this.getOwnOpenOrders(symbol, trackedIds);
      this.writeOrderState([{
        symbol,
        orders: openOrders,
        expectedOrders: this.slicesExecuted,
      }]);

    } catch (error) {
      const errorMsg = (error as Error).message;
      logger.error(`[TWAPBot] Error: ${errorMsg}`);
      events.botError(`TWAPBot error: ${errorMsg}`, { error: errorMsg });
    }

    this.persistTrackedOrders();
  }

  async cancelOwnOrders(): Promise<void> {
    if (this.trackedOrders.length > 0) {
      logger.info(`[TWAPBot] Cancelling ${this.trackedOrders.length} tracked orders`);
      await this.cancelTrackedOrders(this.trackedOrders);
    }
    this.cleanupTrackedOrdersFile();
  }

  private persistTrackedOrders(): void {
    const ordersWithMeta = this.trackedOrders.map((o, i) => ({
      ...o,
      ...(i === 0 ? {
        _slicesExecuted: this.slicesExecuted,
        _referencePrice: this.referencePrice,
        _startTime: this.startTime,
      } : {}),
    }));
    this.saveTrackedOrders('twapbot', ordersWithMeta as TrackedOrder[]);
  }
}
