import { OHLCV } from '@proton/wrap-constants';

/**
 * Simple Moving Average
 */
export function sma(values: number[], period: number): number {
  if (values.length < period) return NaN;
  const slice = values.slice(values.length - period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

/**
 * Exponential Moving Average
 */
export function ema(values: number[], period: number): number {
  if (values.length < period) return NaN;
  const k = 2 / (period + 1);
  let emaCurrent = sma(values.slice(0, period), period);
  for (let i = period; i < values.length; i++) {
    emaCurrent = values[i] * k + emaCurrent * (1 - k);
  }
  return emaCurrent;
}

/**
 * Bollinger Bands — returns { upper, middle, lower }
 */
export function bollingerBands(
  closes: number[],
  period: number,
  stdDevMultiplier = 2.0
): { upper: number; middle: number; lower: number } {
  const middle = sma(closes, period);
  if (isNaN(middle)) return { upper: NaN, middle: NaN, lower: NaN };

  const slice = closes.slice(closes.length - period);
  const variance = slice.reduce((sum, v) => sum + (v - middle) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: middle + stdDev * stdDevMultiplier,
    middle,
    lower: middle - stdDev * stdDevMultiplier,
  };
}

/**
 * Relative Strength Index (0-100)
 */
export function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return NaN;

  let avgGain = 0;
  let avgLoss = 0;

  // Initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // Smoothed RSI
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * MACD — returns { macd, signal, histogram }
 */
export function macd(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): { macd: number; signal: number; histogram: number } {
  const fastEma = ema(closes, fastPeriod);
  const slowEma = ema(closes, slowPeriod);
  if (isNaN(fastEma) || isNaN(slowEma)) {
    return { macd: NaN, signal: NaN, histogram: NaN };
  }

  // Build MACD line series
  const macdLine: number[] = [];
  for (let i = slowPeriod; i <= closes.length; i++) {
    const slice = closes.slice(0, i);
    const f = ema(slice, fastPeriod);
    const s = ema(slice, slowPeriod);
    if (!isNaN(f) && !isNaN(s)) {
      macdLine.push(f - s);
    }
  }

  const macdValue = macdLine[macdLine.length - 1] ?? NaN;
  const signalValue = ema(macdLine, signalPeriod);

  return {
    macd: macdValue,
    signal: isNaN(signalValue) ? NaN : signalValue,
    histogram: isNaN(signalValue) ? NaN : macdValue - signalValue,
  };
}

/**
 * Volatility — standard deviation of log returns from OHLCV candles
 */
export function volatility(candles: OHLCV[]): number {
  if (candles.length < 2) return 0;

  const logReturns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i - 1].close > 0 && candles[i].close > 0) {
      logReturns.push(Math.log(candles[i].close / candles[i - 1].close));
    }
  }

  if (logReturns.length === 0) return 0;

  const mean = logReturns.reduce((s, v) => s + v, 0) / logReturns.length;
  const variance = logReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / logReturns.length;
  return Math.sqrt(variance);
}
