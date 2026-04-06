import { BigNumber as BN } from 'bignumber.js';
import { ORDERSIDES } from '../core/constants';
import { BotConfig, ScannerBotConfig, TradeOrder, TrackedOrder } from '../interfaces';
import { getLogger } from '../utils';
import { TradingStrategyBase, OrderStateEntry } from './base';
import { events } from '../events';

const logger = getLogger();

interface TrackedPosition {
  symbol: string;
  order: TrackedOrder;
  cyclesRemaining: number;
}

/**
 * Market Scanner/Rotator Strategy
 * Scans daily summaries for all markets, filters by volume and change %,
 * and rotates into the top movers.
 */
export class ScannerBotStrategy extends TradingStrategyBase {
  private config!: ScannerBotConfig;
  private positions: TrackedPosition[] = [];

  async initialize(options?: BotConfig['scannerBot']): Promise<void> {
    if (!options) throw new Error('ScannerBot config is required');
    this.config = options;

    const persisted = this.loadTrackedOrders();
    if (persisted.length > 0) {
      for (const order of persisted) {
        this.positions.push({
          symbol: order.marketSymbol,
          order,
          cyclesRemaining: (order as any)._cyclesRemaining ?? this.config.holdDurationCycles,
        });
      }
      logger.info(`[ScannerBot] Recovered ${persisted.length} positions from disk`);
    }
  }

  async trade(): Promise<void> {
    const { minVolumeThreshold, minChangePct, maxPairs, orderAmount, holdDurationCycles } = this.config;

    try {
      // 1. Expire positions
      const expiring = this.positions.filter(p => p.cyclesRemaining <= 0);
      for (const pos of expiring) {
        if (pos.order.orderId) {
          try {
            const { cancelOrder } = await import('../dexrpc');
            await cancelOrder(String(pos.order.orderId));
            logger.info(`[ScannerBot] Expired position in ${pos.symbol}, cancelled order ${pos.order.orderId}`);
          } catch (err) {
            logger.warn(`[ScannerBot] Failed to cancel expired order: ${(err as Error).message}`);
          }
        }
      }
      this.positions = this.positions.filter(p => p.cyclesRemaining > 0);

      // Decrement remaining cycles
      for (const pos of this.positions) {
        pos.cyclesRemaining--;
      }

      // 2. Fetch daily summaries
      const dailySummaries = await this.dexAPI.fetchDaily();
      if (!dailySummaries || dailySummaries.length === 0) {
        logger.warn('[ScannerBot] No daily data available');
        return;
      }

      // 3. Filter by volume and change thresholds
      const candidates = dailySummaries
        .filter(d => d.volume_ask >= minVolumeThreshold && Math.abs(d.change_percentage) >= minChangePct)
        .sort((a, b) => Math.abs(b.change_percentage) - Math.abs(a.change_percentage))
        .slice(0, maxPairs);

      logger.info(`[ScannerBot] Found ${candidates.length} candidates from ${dailySummaries.length} markets`);

      // 4. Open new positions for candidates we're not already in
      const currentSymbols = new Set(this.positions.map(p => p.symbol));
      const slotsAvailable = maxPairs - this.positions.length;

      const newCandidates = candidates
        .filter(c => !currentSymbols.has(c.symbol))
        .slice(0, slotsAvailable);

      for (const candidate of newCandidates) {
        const market = this.dexAPI.getMarketBySymbol(candidate.symbol);
        if (!market) continue;

        const bidPrecision = market.bid_token.precision;
        const askPrecision = market.ask_token.precision;

        // Momentum follow: buy winners
        if (candidate.change_percentage > 0) {
          const buyPrice = new BN(candidate.close).toFixed(askPrecision);
          const quantity = +new BN(orderAmount).dividedBy(buyPrice).toFixed(bidPrecision);

          const order: TradeOrder = {
            orderSide: ORDERSIDES.BUY,
            price: +buyPrice,
            quantity,
            marketSymbol: candidate.symbol,
          };

          await this.placeOrders([order]);
          const [resolved] = await this.resolveOrderIds([order], candidate.symbol);

          this.positions.push({
            symbol: candidate.symbol,
            order: resolved,
            cyclesRemaining: holdDurationCycles,
          });

          logger.info(`[ScannerBot] BUY ${candidate.symbol} (change: ${candidate.change_percentage.toFixed(2)}%, vol: ${candidate.volume_ask.toFixed(0)})`);
          events.orderPlaced(`[ScannerBot] BUY ${candidate.symbol}`, {
            market: candidate.symbol,
            change: candidate.change_percentage,
            volume: candidate.volume_ask,
          });
        }
      }

      // Write order state
      const symbolGroups = new Map<string, TrackedPosition[]>();
      for (const pos of this.positions) {
        const group = symbolGroups.get(pos.symbol) || [];
        group.push(pos);
        symbolGroups.set(pos.symbol, group);
      }

      const orderStateEntries: OrderStateEntry[] = [];
      for (const [sym, positions] of symbolGroups) {
        const trackedIds = new Set(positions.map(p => p.order.orderId).filter((id): id is string => !!id));
        const openOrders = await this.getOwnOpenOrders(sym, trackedIds);
        orderStateEntries.push({
          symbol: sym,
          orders: openOrders,
          expectedOrders: positions.length,
        });
      }
      this.writeOrderState(orderStateEntries);

    } catch (error) {
      const errorMsg = (error as Error).message;
      logger.error(`[ScannerBot] Error: ${errorMsg}`);
      events.botError(`ScannerBot error: ${errorMsg}`, { error: errorMsg });
    }

    this.persistTrackedOrders();
  }

  async cancelOwnOrders(): Promise<void> {
    const allTracked = this.positions.map(p => p.order);
    if (allTracked.length > 0) {
      logger.info(`[ScannerBot] Cancelling ${allTracked.length} tracked orders`);
      await this.cancelTrackedOrders(allTracked);
    }
    this.cleanupTrackedOrdersFile();
  }

  private persistTrackedOrders(): void {
    const allTracked = this.positions.map(p => ({
      ...p.order,
      _cyclesRemaining: p.cyclesRemaining,
    }));
    this.saveTrackedOrders('scannerbot', allTracked as TrackedOrder[]);
  }
}
