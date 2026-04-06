import { describe, it, expect } from 'vitest';
import { sma, ema, bollingerBands, rsi, macd, volatility } from '../../src/utils/indicators';
import type { OHLCV } from '@proton/wrap-constants';

describe('sma', () => {
  it('calculates correct average', () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(sma([10, 20, 30], 3)).toBe(20);
  });

  it('uses only the last N values', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toBe(4); // avg of [3, 4, 5]
  });

  it('returns NaN for insufficient data', () => {
    expect(sma([1, 2], 5)).toBeNaN();
    expect(sma([], 1)).toBeNaN();
  });
});

describe('ema', () => {
  it('calculates correct exponential average', () => {
    const values = [10, 11, 12, 13, 14, 15];
    const result = ema(values, 3);
    expect(result).toBeGreaterThan(13);
    expect(result).toBeLessThan(16);
  });

  it('returns NaN for insufficient data', () => {
    expect(ema([1, 2], 5)).toBeNaN();
  });

  it('converges toward recent values', () => {
    const rising = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = ema(rising, 3);
    // EMA with period 3 on rising data should be >= SMA
    expect(result).toBeGreaterThanOrEqual(sma(rising, 3));
  });
});

describe('bollingerBands', () => {
  it('returns upper > middle > lower', () => {
    const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const bb = bollingerBands(closes, 10);
    expect(bb.upper).toBeGreaterThan(bb.middle);
    expect(bb.middle).toBeGreaterThan(bb.lower);
  });

  it('returns NaN for insufficient data', () => {
    const bb = bollingerBands([1, 2], 5);
    expect(bb.upper).toBeNaN();
    expect(bb.middle).toBeNaN();
    expect(bb.lower).toBeNaN();
  });

  it('has correct stddev spread', () => {
    const flat = [10, 10, 10, 10, 10];
    const bb = bollingerBands(flat, 5, 2);
    // All same values → stddev = 0
    expect(bb.upper).toBe(10);
    expect(bb.middle).toBe(10);
    expect(bb.lower).toBe(10);
  });

  it('wider bands with higher multiplier', () => {
    const closes = [10, 12, 8, 14, 6, 15, 9, 11, 13, 7];
    const bb1 = bollingerBands(closes, 10, 1);
    const bb2 = bollingerBands(closes, 10, 3);
    expect(bb2.upper - bb2.lower).toBeGreaterThan(bb1.upper - bb1.lower);
  });
});

describe('rsi', () => {
  it('returns 100 for all gains', () => {
    const allGains = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    expect(rsi(allGains, 14)).toBe(100);
  });

  it('returns 0 for all losses', () => {
    const allLosses = [16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    expect(rsi(allLosses, 14)).toBe(0);
  });

  it('returns value between 0-100 for mixed data', () => {
    const mixed = [44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00];
    const result = rsi(mixed, 14);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(100);
  });

  it('returns NaN for insufficient data', () => {
    expect(rsi([1, 2, 3], 14)).toBeNaN();
  });
});

describe('macd', () => {
  it('returns macd, signal, and histogram', () => {
    // Generate enough data for MACD (need at least 26 + 9 = 35 points)
    const closes = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i * 0.5) * 10);
    const result = macd(closes);
    expect(result).toHaveProperty('macd');
    expect(result).toHaveProperty('signal');
    expect(result).toHaveProperty('histogram');
    expect(result.macd).not.toBeNaN();
    expect(result.signal).not.toBeNaN();
  });

  it('returns NaN for insufficient data', () => {
    const result = macd([1, 2, 3]);
    expect(result.macd).toBeNaN();
  });
});

describe('volatility', () => {
  it('returns 0 for flat data', () => {
    const flat: OHLCV[] = Array.from({ length: 10 }, () => ({
      time: Date.now(), open: 10, high: 10, low: 10, close: 10, volume: 100, volume_bid: 50, count: 10,
    }));
    expect(volatility(flat)).toBe(0);
  });

  it('returns positive value for volatile data', () => {
    const volatile: OHLCV[] = [
      { time: 1, open: 10, high: 12, low: 9, close: 11, volume: 100, volume_bid: 50, count: 10 },
      { time: 2, open: 11, high: 14, low: 10, close: 8, volume: 100, volume_bid: 50, count: 10 },
      { time: 3, open: 8, high: 15, low: 7, close: 14, volume: 100, volume_bid: 50, count: 10 },
      { time: 4, open: 14, high: 16, low: 6, close: 7, volume: 100, volume_bid: 50, count: 10 },
    ];
    expect(volatility(volatile)).toBeGreaterThan(0);
  });

  it('returns 0 for single candle', () => {
    const single: OHLCV[] = [
      { time: 1, open: 10, high: 12, low: 9, close: 11, volume: 100, volume_bid: 50, count: 10 },
    ];
    expect(volatility(single)).toBe(0);
  });
});
