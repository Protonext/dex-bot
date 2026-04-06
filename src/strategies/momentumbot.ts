import { BigNumber as BN } from 'bignumber.js';
import { ORDERSIDES } from '../core/constants';
import { BotConfig, MomentumBotConfig, TradeOrder, TrackedOrder } from '../interfaces';
import { getLogger } from '../utils';
import { TradingStrategyBase, OrderStateEntry } from './base';
import { events } from '../events';
import { bollingerBands, rsi } from '../utils/indicators';

const logger = getLogger();

interface Position {
  side: ORDERSIDES;
  entryPrice: number;
  order: TrackedOrder;
  takeProfitOrder?: TrackedOrder;
}

/**
 * Momentum/Breakout Bot Strategy
 * Uses Bollinger Bands + RSI to detect breakout opportunities.
 * BUY when price < lower band AND RSI < oversold.
 * SELL when price > upper band AND RSI > overbought.
 */
export class MomentumBotStrategy extends TradingStrategyBase {
  private config!: MomentumBotConfig;
  private positions: Position[] = [];

  async initialize(options?: BotConfig['momentumBot']): Promise<void> {
    if (!options) throw new Error('MomentumBot config is required');
    this.config = options;

    const persisted = this.loadTrackedOrders();
    if (persisted.length > 0) {
      for (const order of persisted) {
        this.positions.push({
          side: order.orderSide,
          entryPrice: order.price,
          order,
        });
      }
      logger.info(`[MomentumBot] Recovered ${persisted.length} positions from disk`);
    }
  }

  async trade(): Promise<void> {
    const { symbol, interval, lookbackPeriods, rsiOverbought, rsiOversold, bollingerStdDev, orderAmount, maxPositions } = this.config;

    try {
      const market = this.dexAPI.getMarketBySymbol(symbol);
      if (!market) {
        logger.error(`[MomentumBot] Invalid market: ${symbol}`);
        return;
      }

      const bidPrecision = market.bid_token.precision;
      const askPrecision = market.ask_token.precision;

      // 1. Fetch OHLCV candles
      const candles = await this.dexAPI.fetchOHLCV(symbol, interval, lookbackPeriods);
      if (candles.length < lookbackPeriods) {
        logger.info(`[MomentumBot] Warming up: ${candles.length}/${lookbackPeriods} candles`);
        return;
      }

      const closes = candles.map(c => c.close);
      const currentPrice = closes[closes.length - 1];

      // 2. Compute indicators
      const bb = bollingerBands(closes, lookbackPeriods, bollingerStdDev);
      const currentRSI = rsi(closes, 14);

      logger.info(`[MomentumBot] ${symbol} Price: ${currentPrice}, BB: [${bb.lower.toFixed(6)}, ${bb.middle.toFixed(6)}, ${bb.upper.toFixed(6)}], RSI: ${currentRSI.toFixed(1)}`);

      // 3. Fill detection on existing positions
      const trackedIds = new Set<string>(
        this.positions.flatMap(p => [p.order.orderId, p.takeProfitOrder?.orderId].filter((id): id is string => !!id))
      );
      const openOrders = await this.getOwnOpenOrders(symbol, trackedIds);

      // Check take-profit fills
      const remainingPositions: Position[] = [];
      for (const pos of this.positions) {
        if (pos.takeProfitOrder) {
          const stillOpen = pos.takeProfitOrder.orderId
            ? openOrders.find(o => o.order_id === pos.takeProfitOrder!.orderId)
            : null;
          if (!stillOpen) {
            logger.info(`[MomentumBot] Take-profit filled for position at ${pos.entryPrice}`);
            events.orderFilled(`[MomentumBot] Take-profit filled at ${pos.takeProfitOrder.price}`, {
              market: symbol, price: pos.takeProfitOrder.price,
            });
            continue; // Position closed
          }
        }
        remainingPositions.push(pos);
      }
      this.positions = remainingPositions;

      // 4. Signal detection
      const newOrders: TradeOrder[] = [];

      if (this.positions.length < maxPositions) {
        // BUY signal: price below lower band AND RSI oversold
        if (currentPrice < bb.lower && currentRSI < rsiOversold) {
          const buyPrice = new BN(currentPrice).toFixed(askPrecision);
          const quantity = +new BN(orderAmount).dividedBy(buyPrice).toFixed(bidPrecision);
          const order: TradeOrder = {
            orderSide: ORDERSIDES.BUY,
            price: +buyPrice,
            quantity,
            marketSymbol: symbol,
          };
          newOrders.push(order);
          logger.info(`[MomentumBot] BUY signal: price ${currentPrice} < lower band ${bb.lower.toFixed(6)}, RSI ${currentRSI.toFixed(1)}`);
        }

        // SELL signal: price above upper band AND RSI overbought
        if (currentPrice > bb.upper && currentRSI > rsiOverbought) {
          const sellPrice = new BN(currentPrice).toFixed(askPrecision);
          const quantity = +new BN(orderAmount).dividedBy(sellPrice).toFixed(bidPrecision);
          const order: TradeOrder = {
            orderSide: ORDERSIDES.SELL,
            price: +sellPrice,
            quantity,
            marketSymbol: symbol,
          };
          newOrders.push(order);
          logger.info(`[MomentumBot] SELL signal: price ${currentPrice} > upper band ${bb.upper.toFixed(6)}, RSI ${currentRSI.toFixed(1)}`);
        }
      }

      // 5. Place new orders and create take-profit
      if (newOrders.length > 0) {
        await this.placeOrders(newOrders);
        const resolved = await this.resolveOrderIds(newOrders, symbol);

        for (const order of resolved) {
          // Place take-profit at Bollinger middle band
          const tpPrice = new BN(bb.middle).toFixed(askPrecision);
          const tpSide = order.orderSide === ORDERSIDES.BUY ? ORDERSIDES.SELL : ORDERSIDES.BUY;
          const tpQuantity = +new BN(orderAmount).dividedBy(tpPrice).toFixed(bidPrecision);
          const tpOrder: TradeOrder = {
            orderSide: tpSide,
            price: +tpPrice,
            quantity: tpQuantity,
            marketSymbol: symbol,
          };

          await this.placeOrders([tpOrder]);
          const [resolvedTP] = await this.resolveOrderIds([tpOrder], symbol);

          this.positions.push({
            side: order.orderSide,
            entryPrice: order.price,
            order,
            takeProfitOrder: resolvedTP,
          });
        }
      }

      // Write order state
      const orderStateEntries: OrderStateEntry[] = [{
        symbol,
        orders: openOrders,
        expectedOrders: this.positions.length * 2,
      }];
      this.writeOrderState(orderStateEntries);

    } catch (error) {
      const errorMsg = (error as Error).message;
      logger.error(`[MomentumBot] Error: ${errorMsg}`);
      events.botError(`MomentumBot error: ${errorMsg}`, { error: errorMsg });
    }

    this.persistTrackedOrders();
  }

  async cancelOwnOrders(): Promise<void> {
    const allTracked: TrackedOrder[] = this.positions.flatMap(p =>
      [p.order, p.takeProfitOrder].filter((o): o is TrackedOrder => !!o)
    );
    if (allTracked.length > 0) {
      logger.info(`[MomentumBot] Cancelling ${allTracked.length} tracked orders`);
      await this.cancelTrackedOrders(allTracked);
    }
    this.cleanupTrackedOrdersFile();
  }

  private persistTrackedOrders(): void {
    const allTracked: TrackedOrder[] = this.positions.flatMap(p =>
      [p.order, p.takeProfitOrder].filter((o): o is TrackedOrder => !!o)
    );
    this.saveTrackedOrders('momentumbot', allTracked);
  }
}
