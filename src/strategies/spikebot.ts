// spike bot strategy
import { BigNumber as BN } from 'bignumber.js';
import { ORDERSIDES } from '../core/constants';
import { BotConfig, SpikeBotPair, TradeOrder, TrackedOrder, TradingStrategy } from '../interfaces';
import { getLogger, getUsername } from '../utils';
import { TradingStrategyBase, OrderStateEntry } from './base';
import * as dexrpc from '../dexrpc';
import { events } from '../events';
import { Market } from '@proton/wrap-constants';

const logger = getLogger();

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface PairState {
  config: SpikeBotPair;
  priceHistory: number[];
  currentMA: number;
  lastOrderMA: number;
  spikeOrders: TrackedOrder[];
  takeProfitOrders: TrackedOrder[];
}

/**
 * Spike Bot Strategy
 * Catches brief price spikes by pre-placing limit orders at extreme deviation levels from a moving average.
 * Resting orders on the order book get matched by the DEX engine instantly, avoiding the need for polling-based detection.
 */
export class SpikeBotStrategy extends TradingStrategyBase implements TradingStrategy {
  private pairStates: PairState[] = [];
  private maWindow: number = 20;
  private rebalanceThresholdPct: number = 1.0;

  async initialize(options?: BotConfig['spikeBot']): Promise<void> {
    if (options) {
      this.maWindow = options.maWindow;
      this.rebalanceThresholdPct = options.rebalanceThresholdPct;
      this.pairStates = options.pairs.map(pair => ({
        config: pair,
        priceHistory: [],
        currentMA: 0,
        lastOrderMA: 0,
        spikeOrders: [],
        takeProfitOrders: [],
      }));

      // Recover tracked orders from disk
      const persisted = this.loadTrackedOrders();
      if (persisted.length > 0 && this.pairStates.length > 0) {
        // Distribute loaded orders back to their pair states by marketSymbol
        for (const order of persisted) {
          const pairState = this.pairStates.find(s => s.config.symbol === order.marketSymbol);
          if (!pairState) continue;
          // We stored a _type marker to distinguish spike vs take-profit
          if ((order as any)._type === 'takeProfit') {
            pairState.takeProfitOrders.push(order);
          } else {
            pairState.spikeOrders.push(order);
          }
        }
        logger.info(`[SpikeBot] Recovered ${persisted.length} tracked orders from disk`);
      }
    }
  }

  async trade(): Promise<void> {
    const orderStateEntries: OrderStateEntry[] = [];

    for (const state of this.pairStates) {
      try {
        const symbol = state.config.symbol;
        const market = this.dexAPI.getMarketBySymbol(symbol);
        if (!market) {
          logger.error(`[SpikeBot] Invalid market: ${symbol}`);
          continue;
        }

        // 1. Fetch latest price and update rolling window
        const latestPrice = await this.dexAPI.fetchLatestPrice(symbol);
        state.priceHistory.push(latestPrice);
        if (state.priceHistory.length > this.maWindow) {
          state.priceHistory.shift();
        }

        // 2. Calculate MA - skip if not enough data
        if (state.priceHistory.length < this.maWindow) {
          logger.info(`[SpikeBot] ${symbol} warming up: ${state.priceHistory.length}/${this.maWindow} data points`);
          continue;
        }
        state.currentMA = this.calculateMA(state.priceHistory);
        logger.info(`[SpikeBot] ${symbol} - Price: ${latestPrice}, MA: ${state.currentMA.toFixed(market.ask_token.precision)}`);

        // 3. Fetch open orders (filtered to this instance's tracked IDs)
        const allTracked = [...state.spikeOrders, ...state.takeProfitOrders];
        const trackedIds = new Set<string>(
          allTracked.map(o => o.orderId).filter((id): id is string => id !== undefined)
        );
        const openOrders = await this.getOwnOpenOrders(symbol, trackedIds);

        orderStateEntries.push({
          symbol,
          orders: openOrders,
          expectedOrders: state.config.levels * 2,
        });

        // 4. Fill detection - spike orders
        if (state.spikeOrders.length > 0) {
          const newOrders: TradeOrder[] = [];
          const remainingSpike: TrackedOrder[] = [];

          for (const tracked of state.spikeOrders) {
            // Use order ID for fill detection when available, fall back to price+side
            const stillOpen = tracked.orderId
              ? openOrders.find(o => o.order_id === tracked.orderId)
              : openOrders.find(o => o.price === tracked.price && o.order_side === tracked.orderSide);

            if (!stillOpen) {
              // Spike order was filled
              const sideStr = tracked.orderSide === ORDERSIDES.BUY ? 'BUY' : 'SELL';
              const fillMsg = `[SpikeBot] Filled ${sideStr} spike at ${tracked.price} for ${symbol}`;
              logger.info(fillMsg);
              events.orderFilled(fillMsg, {
                market: symbol,
                side: sideStr,
                quantity: tracked.quantity,
                price: tracked.price,
              });

              // Place take-profit counter-order at MA
              const tpOrder = this.buildTakeProfitOrder(symbol, state.currentMA, tracked.orderSide, state.config.orderAmount, market);
              newOrders.push(tpOrder);
            } else {
              remainingSpike.push(tracked);
            }
          }

          if (newOrders.length > 0) {
            await this.placeOrders(newOrders);
            const resolvedTP = await this.resolveOrderIds(newOrders, symbol);
            state.takeProfitOrders.push(...resolvedTP);
          }
          state.spikeOrders = remainingSpike;
        }

        // 5. Fill detection - take-profit orders
        if (state.takeProfitOrders.length > 0) {
          const remainingTP: TrackedOrder[] = [];

          for (const tracked of state.takeProfitOrders) {
            const stillOpen = tracked.orderId
              ? openOrders.find(o => o.order_id === tracked.orderId)
              : openOrders.find(o => o.price === tracked.price && o.order_side === tracked.orderSide);

            if (!stillOpen) {
              const sideStr = tracked.orderSide === ORDERSIDES.BUY ? 'BUY' : 'SELL';
              logger.info(`[SpikeBot] Take-profit ${sideStr} filled at ${tracked.price} for ${symbol}`);
              events.orderFilled(`[SpikeBot] Take-profit ${sideStr} filled at ${tracked.price}`, {
                market: symbol,
                side: sideStr,
                quantity: tracked.quantity,
                price: tracked.price,
              });
            } else {
              remainingTP.push(tracked);
            }
          }
          state.takeProfitOrders = remainingTP;
        }

        // 6. MA drift check - rebalance if MA shifted beyond threshold
        if (state.lastOrderMA > 0 && state.spikeOrders.length > 0) {
          const driftPct = Math.abs(state.currentMA - state.lastOrderMA) / state.lastOrderMA * 100;
          if (driftPct > this.rebalanceThresholdPct) {
            logger.info(`[SpikeBot] ${symbol} MA drift ${driftPct.toFixed(2)}% exceeds threshold ${this.rebalanceThresholdPct}% - rebalancing`);
            await this.cancelPairOrders(symbol, openOrders);
            await dexrpc.withdrawAll();
            await delay(2000);
            state.spikeOrders = [];
            state.takeProfitOrders = [];
            // Fall through to initial placement below
          }
        }

        // 7. Initial placement (no tracked spike orders & MA ready)
        if (state.spikeOrders.length === 0) {
          // Cancel any stale on-chain orders from a previous run and withdraw funds
          if (openOrders.length > 0) {
            logger.info(`[SpikeBot] ${symbol} clearing ${openOrders.length} stale orders before fresh placement`);
            await this.cancelPairOrders(symbol, openOrders);
            await dexrpc.withdrawAll();
            await delay(2000);
          }

          const spikeOrders = this.buildSpikeOrders(symbol, state.currentMA, state.config, market);
          if (spikeOrders.length > 0) {
            logger.info(`[SpikeBot] ${symbol} placing ${spikeOrders.length} spike orders around MA ${state.currentMA.toFixed(market.ask_token.precision)}`);
            await this.placeOrders(spikeOrders);
            state.spikeOrders = await this.resolveOrderIds(spikeOrders, symbol);
            state.lastOrderMA = state.currentMA;
          }
        }
      } catch (error) {
        const errorMsg = (error as Error).message;
        logger.error(`[SpikeBot] Error for ${state.config.symbol}: ${errorMsg}`);
        events.botError(`SpikeBot error: ${errorMsg}`, { error: errorMsg });
      }
    }

    // Persist tracked orders for crash recovery
    this.persistAllTrackedOrders();

    this.writeOrderState(orderStateEntries);
  }

  async cancelOwnOrders(): Promise<void> {
    const allTracked: TrackedOrder[] = [];
    for (const state of this.pairStates) {
      allTracked.push(...state.spikeOrders, ...state.takeProfitOrders);
    }
    if (allTracked.length > 0) {
      logger.info(`[SpikeBot] Cancelling ${allTracked.length} tracked orders on shutdown`);
      await this.cancelTrackedOrders(allTracked);
    }
    this.cleanupTrackedOrdersFile();
  }

  private persistAllTrackedOrders(): void {
    const allTracked: (TrackedOrder & { _type?: string })[] = [];
    for (const state of this.pairStates) {
      for (const o of state.spikeOrders) {
        allTracked.push({ ...o, _type: 'spike' });
      }
      for (const o of state.takeProfitOrders) {
        allTracked.push({ ...o, _type: 'takeProfit' });
      }
    }
    this.saveTrackedOrders('spikebot', allTracked as TrackedOrder[]);
  }

  private async cancelPairOrders(symbol: string, openOrders: { order_id: string | number }[]): Promise<void> {
    for (const order of openOrders) {
      try {
        await dexrpc.cancelOrder(String(order.order_id));
      } catch (error) {
        logger.error(`[SpikeBot] Failed to cancel order ${order.order_id}: ${(error as Error).message}`);
      }
    }
  }

  private calculateMA(prices: number[]): number {
    return prices.reduce((sum, p) => sum + p, 0) / prices.length;
  }

  private buildTakeProfitOrder(symbol: string, ma: number, filledSide: ORDERSIDES, orderAmount: number, market: Market): TradeOrder {
    const bidPrecision = market.bid_token.precision;
    const askPrecision = market.ask_token.precision;
    const maPrice = new BN(ma).toFixed(askPrecision);

    if (filledSide === ORDERSIDES.BUY) {
      // Buy spike filled → place take-profit sell at MA
      const { quantity } = this.getQuantityAndAdjustedTotal(maPrice, orderAmount, bidPrecision, askPrecision);
      return {
        orderSide: ORDERSIDES.SELL,
        price: +maPrice,
        quantity,
        marketSymbol: symbol,
      };
    } else {
      // Sell spike filled → place take-profit buy at MA
      const { adjustedTotal } = this.getQuantityAndAdjustedTotal(maPrice, orderAmount, bidPrecision, askPrecision);
      return {
        orderSide: ORDERSIDES.BUY,
        price: +maPrice,
        quantity: adjustedTotal,
        marketSymbol: symbol,
      };
    }
  }

  private buildSpikeOrders(symbol: string, ma: number, pairConfig: SpikeBotPair, market: Market): TradeOrder[] {
    const { deviationPct, levels, orderAmount } = pairConfig;
    const bidPrecision = market.bid_token.precision;
    const askPrecision = market.ask_token.precision;
    const orders: TradeOrder[] = [];

    for (let level = 1; level <= levels; level++) {
      const deviation = deviationPct * level / 100;

      // Buy order below MA
      const buyPrice = new BN(ma).times(1 - deviation).toFixed(askPrecision);
      const { adjustedTotal } = this.getQuantityAndAdjustedTotal(buyPrice, orderAmount, bidPrecision, askPrecision);
      orders.push({
        orderSide: ORDERSIDES.BUY,
        price: +buyPrice,
        quantity: adjustedTotal,
        marketSymbol: symbol,
      });

      // Sell order above MA
      const sellPrice = new BN(ma).times(1 + deviation).toFixed(askPrecision);
      const { quantity } = this.getQuantityAndAdjustedTotal(sellPrice, orderAmount, bidPrecision, askPrecision);
      orders.push({
        orderSide: ORDERSIDES.SELL,
        price: +sellPrice,
        quantity,
        marketSymbol: symbol,
      });

      logger.info(`[SpikeBot] ${symbol} level ${level}: BUY at ${buyPrice}, SELL at ${sellPrice}`);
    }

    return orders;
  }

  private getQuantityAndAdjustedTotal(price: BN | string, totalCost: number, bidPrecision: number, askPrecision: number): {
    quantity: number;
    adjustedTotal: number;
  } {
    const adjustedTotal = +new BN(totalCost).times(price).toFixed(askPrecision);
    const quantity = +new BN(adjustedTotal).dividedBy(price).toFixed(bidPrecision);
    return { quantity, adjustedTotal };
  }
}
