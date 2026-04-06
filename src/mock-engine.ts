import { TradeOrder, MockTrackedOrder } from './interfaces';
import { ORDERSIDES } from './core/constants';
import { Market } from '@proton/wrap-constants';
import * as dexapi from './dexapi';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getLogger } from './utils';

const logger = getLogger();

export class MockEngine {
  private openOrders: MockTrackedOrder[] = [];
  private balances: Record<string, number> = {};
  private stateDir: string;
  private instanceId: string;

  constructor(stateDir: string, instanceId: string) {
    this.stateDir = stateDir;
    this.instanceId = instanceId;
    this.loadState();
  }

  async initializeBalances(
    dexAPI: typeof dexapi,
    username: string,
    symbols: string[],
    overrides?: Record<string, number>
  ): Promise<void> {
    if (overrides && Object.keys(overrides).length > 0) {
      this.balances = { ...overrides };
      logger.info(`[MockEngine] Initialized with synthetic balances: ${JSON.stringify(this.balances)}`);
      return;
    }

    // Fetch real balances from the DEX API
    try {
      const realBalances = await dexAPI.fetchBalances(username);
      for (const bal of realBalances) {
        this.balances[bal.currency] = bal.amount;
      }
      logger.info(`[MockEngine] Initialized with real balances for ${username}: ${Object.keys(this.balances).length} tokens`);
    } catch (error) {
      logger.warn(`[MockEngine] Failed to fetch real balances, starting with empty: ${(error as Error).message}`);
    }
  }

  placeOrder(order: TradeOrder, market: Market): MockTrackedOrder {
    const mockId = randomUUID();
    const bidToken = market.bid_token.code;
    const askToken = market.ask_token.code;

    // Deduct from available balance
    if (order.orderSide === ORDERSIDES.BUY) {
      // Buying base token, need to spend quote token
      const cost = order.quantity * order.price;
      const available = this.balances[askToken] || 0;
      if (cost > available) {
        logger.warn(`[MockEngine] Insufficient ${askToken} balance for BUY: need ${cost}, have ${available}`);
      }
      this.balances[askToken] = Math.max(0, available - cost);
    } else {
      // Selling base token
      const available = this.balances[bidToken] || 0;
      if (order.quantity > available) {
        logger.warn(`[MockEngine] Insufficient ${bidToken} balance for SELL: need ${order.quantity}, have ${available}`);
      }
      this.balances[bidToken] = Math.max(0, available - order.quantity);
    }

    const mockOrder: MockTrackedOrder = {
      ...order,
      mockId,
      orderId: mockId,
      mockStatus: 'open',
      placedAt: new Date().toISOString(),
    };

    this.openOrders.push(mockOrder);
    logger.info(`[MockEngine] Placed ${order.orderSide === ORDERSIDES.BUY ? 'BUY' : 'SELL'} order ${mockId} for ${order.quantity} at ${order.price} on ${order.marketSymbol}`);

    return mockOrder;
  }

  checkFills(symbol: string, currentPrice: number): MockTrackedOrder[] {
    const filled: MockTrackedOrder[] = [];

    for (const order of this.openOrders) {
      if (order.marketSymbol !== symbol || order.mockStatus !== 'open') continue;

      let shouldFill = false;
      if (order.orderSide === ORDERSIDES.BUY && currentPrice <= order.price) {
        shouldFill = true;
      } else if (order.orderSide === ORDERSIDES.SELL && currentPrice >= order.price) {
        shouldFill = true;
      }

      if (shouldFill) {
        order.mockStatus = 'filled';
        order.filledAt = new Date().toISOString();
        order.filledPrice = currentPrice;

        // Update balances on fill
        const market = dexapi.getMarketBySymbol(symbol);
        if (market) {
          const bidToken = market.bid_token.code;
          const askToken = market.ask_token.code;
          const takerFee = market.taker_fee ? market.taker_fee / 100 : 0.001;

          if (order.orderSide === ORDERSIDES.BUY) {
            // Bought base token (minus fee)
            const received = order.quantity * (1 - takerFee);
            this.balances[bidToken] = (this.balances[bidToken] || 0) + received;
          } else {
            // Sold base token, received quote (minus fee)
            const received = order.quantity * currentPrice * (1 - takerFee);
            this.balances[askToken] = (this.balances[askToken] || 0) + received;
          }
        }

        filled.push(order);
        logger.info(`[MockEngine] Filled ${order.orderSide === ORDERSIDES.BUY ? 'BUY' : 'SELL'} order ${order.mockId} at ${currentPrice} on ${symbol}`);
      }
    }

    // Remove filled orders from open list
    this.openOrders = this.openOrders.filter(o => o.mockStatus === 'open');

    return filled;
  }

  cancelOrder(mockId: string): void {
    const order = this.openOrders.find(o => o.mockId === mockId);
    if (!order) return;

    // Return balance
    const market = dexapi.getMarketBySymbol(order.marketSymbol);
    if (market) {
      const bidToken = market.bid_token.code;
      const askToken = market.ask_token.code;

      if (order.orderSide === ORDERSIDES.BUY) {
        const cost = order.quantity * order.price;
        this.balances[askToken] = (this.balances[askToken] || 0) + cost;
      } else {
        this.balances[bidToken] = (this.balances[bidToken] || 0) + order.quantity;
      }
    }

    order.mockStatus = 'cancelled';
    this.openOrders = this.openOrders.filter(o => o.mockId !== mockId);
    logger.info(`[MockEngine] Cancelled order ${mockId}`);
  }

  getOpenOrders(symbol?: string): MockTrackedOrder[] {
    if (symbol) {
      return this.openOrders.filter(o => o.marketSymbol === symbol && o.mockStatus === 'open');
    }
    return this.openOrders.filter(o => o.mockStatus === 'open');
  }

  getBalances(): Record<string, number> {
    return { ...this.balances };
  }

  writeBalanceState(): void {
    if (!this.stateDir || !this.instanceId) return;

    try {
      if (!fs.existsSync(this.stateDir)) {
        fs.mkdirSync(this.stateDir, { recursive: true });
      }

      const data = {
        instanceId: this.instanceId,
        timestamp: new Date().toISOString(),
        balances: this.balances,
        openOrderCount: this.openOrders.length,
      };

      const filePath = path.join(this.stateDir, `${this.instanceId}-mock-balances.json`);
      const tempPath = filePath + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(data));
      fs.renameSync(tempPath, filePath);
    } catch (error) {
      logger.warn('[MockEngine] Failed to write balance state:', error);
    }
  }

  loadState(): void {
    if (!this.stateDir || !this.instanceId) return;

    try {
      const filePath = path.join(this.stateDir, `${this.instanceId}-mock-state.json`);
      if (!fs.existsSync(filePath)) return;

      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data.balances) this.balances = data.balances;
      if (data.openOrders) this.openOrders = data.openOrders;
      logger.info(`[MockEngine] Loaded state: ${Object.keys(this.balances).length} tokens, ${this.openOrders.length} open orders`);
    } catch (error) {
      logger.warn('[MockEngine] Failed to load state:', error);
    }
  }

  saveState(): void {
    if (!this.stateDir || !this.instanceId) return;

    try {
      if (!fs.existsSync(this.stateDir)) {
        fs.mkdirSync(this.stateDir, { recursive: true });
      }

      const data = {
        instanceId: this.instanceId,
        timestamp: new Date().toISOString(),
        balances: this.balances,
        openOrders: this.openOrders,
      };

      const filePath = path.join(this.stateDir, `${this.instanceId}-mock-state.json`);
      const tempPath = filePath + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(data));
      fs.renameSync(tempPath, filePath);
    } catch (error) {
      logger.warn('[MockEngine] Failed to save state:', error);
    }
  }
}
