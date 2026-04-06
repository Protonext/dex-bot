import { BigNumber } from 'bignumber.js';
import { describe, it, expect, beforeEach } from 'vitest';
import { MarketMakerStrategy } from '../../src/strategies/marketmaker';
import { getConfig } from '../../src/utils';
// const { createBuyOrder, createSellOrder } = MarketMakerStrategy;

const marketXbtcXusdt = {
  market_id: 2,
  symbol: 'XBTC_XUSDT',
  status_code: 1,
  type: 'spot',
  maker_fee: 0.001,
  taker_fee: 0.002,
  order_min: '100000',
  bid_token: {
    code: 'XBTC', precision: 8, contract: 'xtokens', multiplier: 100000000,
  },
  ask_token: {
    code: 'XUSDT', precision: 6, contract: 'xtokens', multiplier: 1000000,
  },
};
const marketXprXusdc = {
  market_id: 1,
  symbol: 'XPR_XUSDC',
  status_code: 1,
  type: 'spot',
  maker_fee: 0.001,
  taker_fee: 0.002,
  order_min: '100000',
  bid_token: {
    code: 'XPR', precision: 4, contract: 'eosio.token', multiplier: 10000,
  },
  ask_token: {
    code: 'XUSDC', precision: 6, contract: 'xtokens', multiplier: 1000000,
  },
};
const marketXprXmd = {
  market_id: 3,
  symbol: 'XPR_XMD',
  status_code: 1,
  type: 'spot',
  maker_fee: 0.001,
  taker_fee: 0.002,
  order_min: '10',
  bid_token: {
    code: 'XPR', precision: 4, contract: 'eosio.token', multiplier: 10000,
  },
  ask_token: {
    code: 'XMD', precision: 6, contract: 'xmd.token', multiplier: 1000000,
  },
};

let currentStrategy: MarketMakerStrategy;

describe('createBuyOrder', () => {
  beforeEach(() => {
    const config = getConfig();
    currentStrategy = new MarketMakerStrategy();
    currentStrategy.initialize(config.marketMaker);

  })

  it('should always create an XPR_XUSDC buy order that is at least the order_min value', () => {
    for (let i = 0; i < 10; i += 1) {
      const market = marketXprXusdc;
      const order = (currentStrategy as any).createBuyOrder(market.symbol, {

        highestBid: 0.3745,
        lowestAsk: 0.3925,
        market,
        price: 0.38,
      }, i);
      const total = +(new BigNumber(order.quantity)
        .times(new BigNumber(market.ask_token.multiplier)));
      const orderMin = parseInt(market.order_min, 10);
      expect(total).toBeGreaterThanOrEqual(orderMin);
    }
  });

  it.skip('should always create an XPR_XMD buy order that is at least the order_min value', () => {
    for (let i = 0; i < 10; i += 1) {
      const market = marketXprXmd;
      const order = (currentStrategy as any).createBuyOrder(market.symbol, {
        highestBid: 0.0456,
        lowestAsk: 0.1001,
        market,
        price: 0.1001,
      }, i);
      const total = +(new BigNumber(order.quantity)
        .times(new BigNumber(market.ask_token.multiplier)));
      const orderMin = parseInt(market.order_min, 10);
      expect(total).toBeGreaterThanOrEqual(orderMin);
    }
  });

  // No such pair in default set
  it.skip('should always create an XBTC_XUSDT buy order that is at least the order_min value', () => {
    for (let i = 0; i < 10; i += 1) {
      const market = marketXbtcXusdt;
      const order = (currentStrategy as any).createBuyOrder(market.symbol, {
        highestBid: 18345.1234,
        lowestAsk: 18345.0111,
        market,
        price: 18345.2222,
      }, i);
      const total = +(new BigNumber(order.quantity)
        .times(new BigNumber(market.ask_token.multiplier)));
      const orderMin = parseInt(market.order_min, 10);
      expect(total).toBeGreaterThanOrEqual(orderMin);
    }
  });

  it('should create an XPR_XUSDC buy order that will succeed as a postonly order', () => {
    for (let i = 0; i < 10; i += 1) {
      const market = marketXprXusdc;
      const lowestAsk = 0.3925;
      const order = (currentStrategy as any).createBuyOrder(market.symbol, {
        highestBid: 0.3745,
        lowestAsk,
        market,
        price: 0.38,
      }, i);
      const price = parseFloat(order.price);
      expect(price).toBeLessThan(lowestAsk);
    }
  });

  it.skip('should create an XPR_XMD buy order that will succeed as a postonly order', () => {
    for (let i = 0; i < 10; i += 1) {
      const market = marketXprXmd;
      const lowestAsk = 0.1001;
      const order = (currentStrategy as any).createBuyOrder(market.symbol, {
        highestBid: 0.0456,
        lowestAsk,
        market,
        price: 0.1001,
      }, i);
      const price = parseFloat(order.price);
      expect(price).toBeLessThan(lowestAsk);
    }
  });

  // No such pair in default set
  it.skip('should create an XBTC_XUSDT buy order that will succeed as a postonly order', () => {
    for (let i = 0; i < 10; i += 1) {
      const market = marketXprXmd;
      const lowestAsk = 18345.0111;
      const order = (currentStrategy as any).createBuyOrder(market.symbol, {
        highestBid: 18345.1234,
        lowestAsk,
        market,
        price: 18345.2222,
      }, i);
      const price = parseFloat(order.price);
      expect(price).toBeLessThan(lowestAsk);
    }
  });
});

describe('createSellOrder', () => {
  beforeEach(() => {
    const config = getConfig();
    currentStrategy = new MarketMakerStrategy();
    currentStrategy.initialize(config.marketMaker);
  });

  it('should always create an XPR_XUSDC sell order that is at least the order_min value', () => {
    for (let i = 0; i < 10; i += 1) {
      const market = marketXprXusdc;
      const order = (currentStrategy as any).createBuyOrder(market.symbol, {
        highestBid: 0.3745,
        lowestAsk: 0.3925,
        market,
        price: 0.38,
      }, i);
      const total = +(new BigNumber(order.price)
        .times(new BigNumber(order.quantity))
        .times(new BigNumber(market.ask_token.multiplier)));
      const orderMin = parseInt(market.order_min, 10);
      expect(total).toBeGreaterThanOrEqual(orderMin);
    }
  });

  it.skip('should always create an XPR_XMD sell order that is at least the order_min value', () => {
    for (let i = 0; i < 10; i += 1) {
      const market = marketXprXmd;
      const order = (currentStrategy as any).createSellOrder(market.symbol, {
        highestBid: 0.3745,
        lowestAsk: 0.3925,
        market,
        price: 0.38,
      }, i);
      const total = +(new BigNumber(order.price)
        .times(new BigNumber(order.quantity))
        .times(new BigNumber(market.ask_token.multiplier)));
      const orderMin = parseInt(market.order_min, 10);
      expect(total).toBeGreaterThanOrEqual(orderMin);
    }
  });

  it.skip('should always create an XBTC_XUSDC sell order that is at least the order_min value', () => {
    for (let i = 0; i < 10; i += 1) {
      const market = marketXbtcXusdt;
      const order = (currentStrategy as any).createSellOrder(market.symbol, {
        highestBid: 18345.1234,
        lowestAsk: 18345.0111,
        market,
        price: 18345.2222,
      }, i);
      const total = +(new BigNumber(order.price)
        .times(new BigNumber(order.quantity))
        .times(new BigNumber(market.ask_token.multiplier)));
      const orderMin = parseInt(market.order_min, 10);
      expect(total).toBeGreaterThanOrEqual(orderMin);
    }
  });

  it('should create an XPR_XUSDC sell order that will succeed as a postonly order', () => {
    for (let i = 0; i < 10; i += 1) {
      const market = marketXprXusdc;
      const highestBid = 0.3745;
      const order = (currentStrategy as any).createSellOrder(market.symbol, {
        highestBid,
        lowestAsk: 0.3925,
        market,
        price: 0.38,
      }, i);
      const price = parseFloat(order.price);
      expect(price).toBeGreaterThan(highestBid);
    }
  });

  it.skip('should create an XPR_XMD sell order that will succeed as a postonly order', () => {
    for (let i = 0; i < 10; i += 1) {
      const market = marketXprXmd;
      const highestBid = 0.0456;
      const order = (currentStrategy as any).createSellOrder(market.symbol, {
        highestBid,
        lowestAsk: 0.1001,
        market,
        price: 0.1001,
      }, i);
      const price = parseFloat(order.price);
      expect(price).toBeGreaterThan(highestBid);
    }
  });

  it.skip('should create an XBTC_XUSDT sell order that will succeed as a postonly order', () => {
    for (let i = 0; i < 10; i += 1) {
      const market = marketXprXmd;
      const highestBid = 18345.1234;
      const order = (currentStrategy as any).createSellOrder(market.symbol, {
        highestBid,
        lowestAsk: 18345.0111,
        market,
        price: 18345.2222,
      }, i);
      const price = parseFloat(order.price);
      expect(price).toBeGreaterThan(highestBid);
    }
  });
});
