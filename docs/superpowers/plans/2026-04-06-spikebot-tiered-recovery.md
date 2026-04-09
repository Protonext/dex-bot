# Spike Bot Tiered Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two bugs in spike bot take-profit handling and add gradual price adjustment with hard-floor protection so positions resolve autonomously after spike fills.

**Architecture:** Extend the existing `SpikeBotStrategy.trade()` loop with a new recovery phase between fill detection and spike re-placement. Take-profit orders gain metadata fields (`entryPrice`, `cyclesSincePlace`, `originalTargetPrice`) that persist through crash recovery. Two new config fields control patience duration and step size.

**Tech Stack:** TypeScript, Vitest, BigNumber.js, existing dexrpc/dexapi layer

---

### File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/interfaces/config.interface.ts` | Modify | Add `maxReboundCycles?` and `reboundStepPct?` to spikeBot config |
| `src/interfaces/order.interface.ts` | Modify | Add `entryPrice?`, `cyclesSincePlace?`, `originalTargetPrice?` to `TrackedOrder` |
| `config/default.json` | Modify | Add default values for new config fields |
| `src/strategies/spikebot.ts` | Modify | Bug fixes + tiered recovery logic |
| `test/strategies/spikebot.test.ts` | Create | Full test coverage for spike bot recovery |

---

### Task 1: Config & Interface Changes

**Files:**
- Modify: `src/interfaces/config.interface.ts:141-145`
- Modify: `src/interfaces/order.interface.ts:10-13`
- Modify: `config/default.json:59-70`

- [ ] **Step 1: Add optional fields to `BotConfig['spikeBot']`**

In `src/interfaces/config.interface.ts`, change the spikeBot property in `BotConfig`:

```typescript
spikeBot: {
    pairs: SpikeBotPair[];
    maWindow: number;
    rebalanceThresholdPct: number;
    maxReboundCycles?: number;
    reboundStepPct?: number;
};
```

- [ ] **Step 2: Add recovery metadata to `TrackedOrder`**

In `src/interfaces/order.interface.ts`, add optional fields to `TrackedOrder`:

```typescript
export interface TrackedOrder extends TradeOrder {
    orderId?: string;    // on-chain order_id from the DEX
    placedAt?: string;   // ISO timestamp for debugging
    entryPrice?: number;         // spike fill price (hard floor for TP adjustment)
    cyclesSincePlace?: number;   // trade cycles this TP has been open
    originalTargetPrice?: number; // MA at time of TP placement
}
```

- [ ] **Step 3: Add defaults to `config/default.json`**

In the `spikeBot` section of `config/default.json`, add the two new fields:

```json
"spikeBot": {
  "maWindow": 10,
  "rebalanceThresholdPct": 2.0,
  "maxReboundCycles": 20,
  "reboundStepPct": 0.5,
  "pairs": [
    {
      "symbol": "XMT_XMD",
      "deviationPct": 10.0,
      "levels": 2,
      "orderAmount": 20
    }
  ]
}
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/interfaces/config.interface.ts src/interfaces/order.interface.ts config/default.json
git commit -m "feat(spikebot): add config and interface fields for tiered recovery"
```

---

### Task 2: Bug Fix — MA Drift Check & Re-Placement Guard

**Files:**
- Modify: `src/strategies/spikebot.ts:173,187`
- Test: `test/strategies/spikebot.test.ts`

- [ ] **Step 1: Write test — MA drift check runs during take-profit phase**

Create `test/strategies/spikebot.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDexAPI, createMockMarket } from '../helpers/mock-dexapi';

vi.mock('../../src/utils', () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  getConfig: () => ({
    dashboard: {}, username: 'testuser', strategy: 'spikeBot',
    rpc: { apiRoot: 'https://test', lightApiRoot: 'https://test', endpoints: [], privateKeyPermission: 'active' },
  }),
  getUsername: () => 'testuser',
}));

vi.mock('../../src/events', () => ({
  events: {
    orderPlaced: vi.fn(), orderFilled: vi.fn(), orderCancelled: vi.fn(),
    botError: vi.fn(), gridPlaced: vi.fn(), gridAdjusted: vi.fn(), initialize: vi.fn(),
  },
}));

vi.mock('../../src/dexrpc', () => ({
  prepareLimitOrder: vi.fn(),
  submitProcessAction: vi.fn(),
  submitOrders: vi.fn(),
  cancelOrder: vi.fn(),
  withdrawAll: vi.fn(),
}));

const mockDexAPI = createMockDexAPI();

import { SpikeBotStrategy } from '../../src/strategies/spikebot';
import { cancelOrder, withdrawAll } from '../../src/dexrpc';

describe('SpikeBotStrategy', () => {
  let strategy: SpikeBotStrategy;
  const XMT_XMD_MARKET = createMockMarket({
    market_id: 2,
    symbol: 'XMT_XMD',
    bid_token: { code: 'XMT', precision: 4, contract: 'eosio.token', multiplier: 10000 },
    ask_token: { code: 'XMD', precision: 6, contract: 'eosio.token', multiplier: 1000000 },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    strategy = new SpikeBotStrategy();
    (strategy as any).dexAPI = mockDexAPI;
    (strategy as any).username = 'testuser';
    mockDexAPI.getMarketBySymbol.mockReturnValue(XMT_XMD_MARKET);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([]);
  });

  function warmUpMA(strategy: SpikeBotStrategy, price: number, window: number) {
    const state = (strategy as any).pairStates[0];
    state.priceHistory = Array(window).fill(price);
    state.currentMA = price;
    state.lastOrderMA = price;
  }

  describe('Bug fix: MA drift check during take-profit phase', () => {
    it('triggers rebalance when only take-profit orders exist and MA drifts', async () => {
      await strategy.initialize({
        maWindow: 10, rebalanceThresholdPct: 2.0,
        pairs: [{ symbol: 'XMT_XMD', deviationPct: 10, levels: 1, orderAmount: 20 }],
      });

      warmUpMA(strategy, 1.0, 10);
      const state = (strategy as any).pairStates[0];

      // Simulate: spike orders empty, take-profit active, MA has drifted 5%
      state.spikeOrders = [];
      state.takeProfitOrders = [{
        orderSide: 2, price: 1.0, quantity: 20, marketSymbol: 'XMT_XMD',
        orderId: 'tp-1', entryPrice: 0.9, cyclesSincePlace: 0, originalTargetPrice: 1.0,
      }];
      state.lastOrderMA = 1.0;

      // Price drifted to 1.06 -> MA will be 1.06 -> drift = 6% > 2% threshold
      mockDexAPI.fetchLatestPrice.mockResolvedValue(1.06);
      mockDexAPI.fetchPairOpenOrders.mockResolvedValue([
        { order_id: 'tp-1', price: 1.0, order_side: 2 },
      ]);

      await strategy.trade();

      // Should have cancelled the stale TP order during rebalance
      expect(cancelOrder).toHaveBeenCalledWith('tp-1');
    });
  });

  describe('Bug fix: no re-placement while take-profit active', () => {
    it('does not place spike orders when take-profit is outstanding', async () => {
      await strategy.initialize({
        maWindow: 10, rebalanceThresholdPct: 2.0,
        pairs: [{ symbol: 'XMT_XMD', deviationPct: 10, levels: 1, orderAmount: 20 }],
      });

      warmUpMA(strategy, 1.0, 10);
      const state = (strategy as any).pairStates[0];

      // Simulate: no spike orders, but take-profit is active
      state.spikeOrders = [];
      state.takeProfitOrders = [{
        orderSide: 2, price: 1.0, quantity: 20, marketSymbol: 'XMT_XMD',
        orderId: 'tp-1', entryPrice: 0.9, cyclesSincePlace: 0, originalTargetPrice: 1.0,
      }];
      state.lastOrderMA = 1.0;

      mockDexAPI.fetchLatestPrice.mockResolvedValue(1.0);
      mockDexAPI.fetchPairOpenOrders.mockResolvedValue([
        { order_id: 'tp-1', price: 1.0, order_side: 2 },
      ]);

      const { prepareLimitOrder } = await import('../../src/dexrpc');
      await strategy.trade();

      // Should NOT have placed new spike orders
      expect(prepareLimitOrder).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/strategies/spikebot.test.ts`
Expected: FAIL — the MA drift test fails because the condition skips when `spikeOrders` is empty, and the re-placement test fails because spike orders get placed despite active take-profit.

- [ ] **Step 3: Fix MA drift check condition**

In `src/strategies/spikebot.ts`, change line 173 from:

```typescript
if (state.lastOrderMA > 0 && state.spikeOrders.length > 0) {
```

to:

```typescript
if (state.lastOrderMA > 0 && (state.spikeOrders.length > 0 || state.takeProfitOrders.length > 0)) {
```

- [ ] **Step 4: Fix re-placement guard**

In `src/strategies/spikebot.ts`, change line 187 from:

```typescript
if (state.spikeOrders.length === 0) {
```

to:

```typescript
if (state.spikeOrders.length === 0 && state.takeProfitOrders.length === 0) {
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/strategies/spikebot.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/strategies/spikebot.ts test/strategies/spikebot.test.ts
git commit -m "fix(spikebot): MA drift check and re-placement guard during take-profit phase"
```

---

### Task 3: Store Recovery Metadata on Spike Fill

**Files:**
- Modify: `src/strategies/spikebot.ts:108-144`
- Test: `test/strategies/spikebot.test.ts`

- [ ] **Step 1: Write test — take-profit orders carry entry metadata**

Add to `test/strategies/spikebot.test.ts`:

```typescript
describe('Spike fill metadata', () => {
  it('stores entryPrice, cyclesSincePlace, and originalTargetPrice on take-profit orders', async () => {
    await strategy.initialize({
      maWindow: 10, rebalanceThresholdPct: 2.0,
      pairs: [{ symbol: 'XMT_XMD', deviationPct: 10, levels: 1, orderAmount: 20 }],
    });

    warmUpMA(strategy, 1.0, 10);
    const state = (strategy as any).pairStates[0];

    // Simulate a BUY spike order at 0.90 that has been filled (not in open orders)
    state.spikeOrders = [{
      orderSide: 1, price: 0.9, quantity: 20, marketSymbol: 'XMT_XMD', orderId: 'spike-1',
    }];
    state.lastOrderMA = 1.0;

    mockDexAPI.fetchLatestPrice.mockResolvedValue(1.0);
    // spike-1 is NOT in open orders -> it was filled
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([]);

    await strategy.trade();

    // The take-profit order should have recovery metadata
    const tp = state.takeProfitOrders[0];
    expect(tp).toBeDefined();
    expect(tp.entryPrice).toBe(0.9);
    expect(tp.cyclesSincePlace).toBe(0);
    expect(tp.originalTargetPrice).toBe(1.0);
    // Take-profit for a filled BUY should be a SELL at MA
    expect(tp.orderSide).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/strategies/spikebot.test.ts`
Expected: FAIL — `tp.entryPrice` is `undefined`

- [ ] **Step 3: Implement — attach metadata when building take-profit after spike fill**

In `src/strategies/spikebot.ts`, in the spike fill detection block (around line 131-133), change:

```typescript
// Place take-profit counter-order at MA
const tpOrder = this.buildTakeProfitOrder(symbol, state.currentMA, tracked.orderSide, state.config.orderAmount, market);
newOrders.push(tpOrder);
```

to:

```typescript
// Place take-profit counter-order at MA
const tpOrder = this.buildTakeProfitOrder(symbol, state.currentMA, tracked.orderSide, state.config.orderAmount, market);
(tpOrder as any).entryPrice = tracked.price;
(tpOrder as any).cyclesSincePlace = 0;
(tpOrder as any).originalTargetPrice = state.currentMA;
newOrders.push(tpOrder);
```

Note: The `as any` cast is needed because `TradeOrder` doesn't have these fields, but `TrackedOrder` does (after Task 1). The objects become `TrackedOrder` after `resolveOrderIds()` spreads the properties. Alternatively, store these in a local map and apply after `resolveOrderIds` — but since `resolveOrderIds` spreads the placed order into the tracked order (`{ ...placed, orderId, placedAt }`), the extra fields carry through.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/strategies/spikebot.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/strategies/spikebot.ts test/strategies/spikebot.test.ts
git commit -m "feat(spikebot): attach recovery metadata to take-profit orders on spike fill"
```

---

### Task 4: Initialize Config Fields in Strategy

**Files:**
- Modify: `src/strategies/spikebot.ts:33-34,36-47`

- [ ] **Step 1: Write test — strategy reads new config fields with defaults**

Add to `test/strategies/spikebot.test.ts`:

```typescript
describe('Config initialization', () => {
  it('uses provided maxReboundCycles and reboundStepPct', async () => {
    await strategy.initialize({
      maWindow: 10, rebalanceThresholdPct: 2.0,
      maxReboundCycles: 30, reboundStepPct: 0.8,
      pairs: [{ symbol: 'XMT_XMD', deviationPct: 10, levels: 1, orderAmount: 20 }],
    });

    expect((strategy as any).maxReboundCycles).toBe(30);
    expect((strategy as any).reboundStepPct).toBe(0.8);
  });

  it('defaults maxReboundCycles to 20 and reboundStepPct to 0.5 when omitted', async () => {
    await strategy.initialize({
      maWindow: 10, rebalanceThresholdPct: 2.0,
      pairs: [{ symbol: 'XMT_XMD', deviationPct: 10, levels: 1, orderAmount: 20 }],
    });

    expect((strategy as any).maxReboundCycles).toBe(20);
    expect((strategy as any).reboundStepPct).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/strategies/spikebot.test.ts`
Expected: FAIL — `maxReboundCycles` is `undefined`

- [ ] **Step 3: Implement — read config in `initialize()`**

In `src/strategies/spikebot.ts`, add two private fields after the existing ones (around line 33-34):

```typescript
private maWindow: number = 20;
private rebalanceThresholdPct: number = 1.0;
private maxReboundCycles: number = 20;
private reboundStepPct: number = 0.5;
```

In the `initialize()` method, after `this.rebalanceThresholdPct = options.rebalanceThresholdPct;` (line 39), add:

```typescript
this.maxReboundCycles = options.maxReboundCycles ?? 20;
this.reboundStepPct = options.reboundStepPct ?? 0.5;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/strategies/spikebot.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/strategies/spikebot.ts test/strategies/spikebot.test.ts
git commit -m "feat(spikebot): initialize maxReboundCycles and reboundStepPct from config"
```

---

### Task 5: Tiered Recovery — Phase 1 (Patience) & Cycle Counting

**Files:**
- Modify: `src/strategies/spikebot.ts` (after take-profit fill detection, before MA drift check)
- Test: `test/strategies/spikebot.test.ts`

- [ ] **Step 1: Write test — cycle counter increments each trade cycle**

Add to `test/strategies/spikebot.test.ts`:

```typescript
describe('Tiered recovery: Phase 1 — Patience', () => {
  it('increments cyclesSincePlace each cycle for unfilled take-profit orders', async () => {
    await strategy.initialize({
      maWindow: 10, rebalanceThresholdPct: 2.0, maxReboundCycles: 20, reboundStepPct: 0.5,
      pairs: [{ symbol: 'XMT_XMD', deviationPct: 10, levels: 1, orderAmount: 20 }],
    });

    warmUpMA(strategy, 1.0, 10);
    const state = (strategy as any).pairStates[0];

    state.spikeOrders = [];
    state.takeProfitOrders = [{
      orderSide: 2, price: 1.0, quantity: 20, marketSymbol: 'XMT_XMD',
      orderId: 'tp-1', entryPrice: 0.9, cyclesSincePlace: 5, originalTargetPrice: 1.0,
    }];
    state.lastOrderMA = 1.0;

    mockDexAPI.fetchLatestPrice.mockResolvedValue(0.95);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([
      { order_id: 'tp-1', price: 1.0, order_side: 2 },
    ]);

    await strategy.trade();

    expect(state.takeProfitOrders[0].cyclesSincePlace).toBe(6);
  });

  it('does not adjust take-profit price while within patience window', async () => {
    await strategy.initialize({
      maWindow: 10, rebalanceThresholdPct: 2.0, maxReboundCycles: 20, reboundStepPct: 0.5,
      pairs: [{ symbol: 'XMT_XMD', deviationPct: 10, levels: 1, orderAmount: 20 }],
    });

    warmUpMA(strategy, 1.0, 10);
    const state = (strategy as any).pairStates[0];

    state.spikeOrders = [];
    state.takeProfitOrders = [{
      orderSide: 2, price: 1.0, quantity: 20, marketSymbol: 'XMT_XMD',
      orderId: 'tp-1', entryPrice: 0.9, cyclesSincePlace: 10, originalTargetPrice: 1.0,
    }];
    state.lastOrderMA = 1.0;

    mockDexAPI.fetchLatestPrice.mockResolvedValue(0.95);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([
      { order_id: 'tp-1', price: 1.0, order_side: 2 },
    ]);

    await strategy.trade();

    // Price should remain unchanged during patience
    expect(state.takeProfitOrders[0].price).toBe(1.0);
    expect(cancelOrder).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/strategies/spikebot.test.ts`
Expected: FAIL — `cyclesSincePlace` remains 5 (not incremented)

- [ ] **Step 3: Implement — add cycle counting after take-profit fill detection**

In `src/strategies/spikebot.ts`, after the take-profit fill detection block (after line 170, before the MA drift check), add:

```typescript
// 5b. Tiered recovery — increment cycle counters for unfilled take-profit orders
for (const tracked of state.takeProfitOrders) {
  if (tracked.cyclesSincePlace !== undefined) {
    tracked.cyclesSincePlace++;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/strategies/spikebot.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/strategies/spikebot.ts test/strategies/spikebot.test.ts
git commit -m "feat(spikebot): increment cycle counter for unfilled take-profit orders"
```

---

### Task 6: Tiered Recovery — Phase 2 (Gradual Adjustment)

**Files:**
- Modify: `src/strategies/spikebot.ts`
- Test: `test/strategies/spikebot.test.ts`

- [ ] **Step 1: Write test — SELL take-profit adjusts downward after patience expires**

Add to `test/strategies/spikebot.test.ts`:

```typescript
describe('Tiered recovery: Phase 2 — Gradual Adjustment', () => {
  it('adjusts SELL take-profit price downward after maxReboundCycles', async () => {
    await strategy.initialize({
      maWindow: 10, rebalanceThresholdPct: 2.0, maxReboundCycles: 5, reboundStepPct: 1.0,
      pairs: [{ symbol: 'XMT_XMD', deviationPct: 10, levels: 1, orderAmount: 20 }],
    });

    warmUpMA(strategy, 0.95, 10);
    const state = (strategy as any).pairStates[0];

    // SELL TP at 1.0, entry was BUY at 0.9, patience expired (cycles=6 > max=5)
    state.spikeOrders = [];
    state.takeProfitOrders = [{
      orderSide: 2, price: 1.0, quantity: 20, marketSymbol: 'XMT_XMD',
      orderId: 'tp-1', entryPrice: 0.9, cyclesSincePlace: 6, originalTargetPrice: 1.0,
    }];
    state.lastOrderMA = 0.95;

    mockDexAPI.fetchLatestPrice.mockResolvedValue(0.95);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([
      { order_id: 'tp-1', price: 1.0, order_side: 2 },
    ]);

    await strategy.trade();

    // Old TP should be cancelled
    expect(cancelOrder).toHaveBeenCalledWith('tp-1');
    // New price = 1.0 - (1.0 * 1.0 / 100) = 0.99
    expect(state.takeProfitOrders[0].price).toBeCloseTo(0.99, 4);
  });

  it('adjusts BUY take-profit price upward after maxReboundCycles', async () => {
    await strategy.initialize({
      maWindow: 10, rebalanceThresholdPct: 2.0, maxReboundCycles: 5, reboundStepPct: 1.0,
      pairs: [{ symbol: 'XMT_XMD', deviationPct: 10, levels: 1, orderAmount: 20 }],
    });

    warmUpMA(strategy, 1.05, 10);
    const state = (strategy as any).pairStates[0];

    // BUY TP at 1.0, entry was SELL at 1.1, patience expired
    state.spikeOrders = [];
    state.takeProfitOrders = [{
      orderSide: 1, price: 1.0, quantity: 20, marketSymbol: 'XMT_XMD',
      orderId: 'tp-1', entryPrice: 1.1, cyclesSincePlace: 6, originalTargetPrice: 1.0,
    }];
    state.lastOrderMA = 1.05;

    mockDexAPI.fetchLatestPrice.mockResolvedValue(1.05);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([
      { order_id: 'tp-1', price: 1.0, order_side: 1 },
    ]);

    await strategy.trade();

    expect(cancelOrder).toHaveBeenCalledWith('tp-1');
    // New price = 1.0 + (1.0 * 1.0 / 100) = 1.01
    expect(state.takeProfitOrders[0].price).toBeCloseTo(1.01, 4);
  });

  it('does not adjust SELL take-profit upward (only moves toward market)', async () => {
    await strategy.initialize({
      maWindow: 10, rebalanceThresholdPct: 2.0, maxReboundCycles: 5, reboundStepPct: 1.0,
      pairs: [{ symbol: 'XMT_XMD', deviationPct: 10, levels: 1, orderAmount: 20 }],
    });

    warmUpMA(strategy, 1.05, 10);
    const state = (strategy as any).pairStates[0];

    // SELL TP at 1.0, MA is now ABOVE at 1.05 — don't move TP up
    state.spikeOrders = [];
    state.takeProfitOrders = [{
      orderSide: 2, price: 1.0, quantity: 20, marketSymbol: 'XMT_XMD',
      orderId: 'tp-1', entryPrice: 0.9, cyclesSincePlace: 6, originalTargetPrice: 1.0,
    }];
    state.lastOrderMA = 1.05;

    mockDexAPI.fetchLatestPrice.mockResolvedValue(1.05);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([
      { order_id: 'tp-1', price: 1.0, order_side: 2 },
    ]);

    await strategy.trade();

    // Should NOT cancel/adjust — price can only move down for SELL TP
    expect(cancelOrder).not.toHaveBeenCalled();
    expect(state.takeProfitOrders[0].price).toBe(1.0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/strategies/spikebot.test.ts`
Expected: FAIL — no adjustment logic exists yet

- [ ] **Step 3: Implement — gradual adjustment logic**

In `src/strategies/spikebot.ts`, after the cycle counter increment block (added in Task 5), add the adjustment logic. This goes right after the `cyclesSincePlace++` loop and before the MA drift check:

```typescript
// 5c. Tiered recovery — Phase 2: gradual adjustment after patience expires
const adjustedTP: TrackedOrder[] = [];
let tpOrdersChanged = false;

for (const tracked of state.takeProfitOrders) {
  if (
    tracked.cyclesSincePlace !== undefined &&
    tracked.entryPrice !== undefined &&
    tracked.cyclesSincePlace > this.maxReboundCycles
  ) {
    const currentPrice = tracked.price;
    let candidatePrice: number;

    if (tracked.orderSide === ORDERSIDES.SELL) {
      // SELL TP: only move downward (toward lower MA)
      candidatePrice = currentPrice - (currentPrice * this.reboundStepPct / 100);
      if (candidatePrice >= currentPrice) {
        // MA is above TP — don't move up, just keep it
        adjustedTP.push(tracked);
        continue;
      }
    } else {
      // BUY TP: only move upward (toward higher MA)
      candidatePrice = currentPrice + (currentPrice * this.reboundStepPct / 100);
      if (candidatePrice <= currentPrice) {
        adjustedTP.push(tracked);
        continue;
      }
    }

    // Hard floor check — will be implemented in Task 7
    // For now, proceed with adjustment

    // Cancel old order, place new one at adjusted price
    if (tracked.orderId) {
      try {
        await dexrpc.cancelOrder(String(tracked.orderId));
        await dexrpc.withdrawAll();
        await delay(2000);
      } catch (error) {
        logger.error(`[SpikeBot] Failed to cancel TP order ${tracked.orderId}: ${(error as Error).message}`);
        adjustedTP.push(tracked);
        continue;
      }
    }

    const adjustedOrder = this.buildTakeProfitOrder(
      symbol, candidatePrice, tracked.orderSide === ORDERSIDES.SELL ? ORDERSIDES.BUY : ORDERSIDES.SELL,
      state.config.orderAmount, market
    );
    (adjustedOrder as any).entryPrice = tracked.entryPrice;
    (adjustedOrder as any).cyclesSincePlace = tracked.cyclesSincePlace;
    (adjustedOrder as any).originalTargetPrice = tracked.originalTargetPrice;

    await this.placeOrders([adjustedOrder]);
    const resolved = await this.resolveOrderIds([adjustedOrder], symbol);
    if (resolved.length > 0) {
      const newTracked = resolved[0];
      newTracked.entryPrice = tracked.entryPrice;
      newTracked.cyclesSincePlace = tracked.cyclesSincePlace;
      newTracked.originalTargetPrice = tracked.originalTargetPrice;
      adjustedTP.push(newTracked);
    }

    const oldPrice = currentPrice.toFixed(market.ask_token.precision);
    const newPrice = candidatePrice.toFixed(market.ask_token.precision);
    const sideStr = tracked.orderSide === ORDERSIDES.BUY ? 'BUY' : 'SELL';
    logger.info(`[SpikeBot] Adjusted ${sideStr} take-profit: ${oldPrice} -> ${newPrice} (cycle ${tracked.cyclesSincePlace})`);
    events.gridAdjusted(`[SpikeBot] Adjusted ${sideStr} TP: ${oldPrice} -> ${newPrice}`, {
      market: symbol,
      side: sideStr,
      oldPrice: currentPrice,
      newPrice: candidatePrice,
      cycles: tracked.cyclesSincePlace,
    });
    tpOrdersChanged = true;
  } else {
    adjustedTP.push(tracked);
  }
}

if (tpOrdersChanged) {
  state.takeProfitOrders = adjustedTP;
}
```

**Important note on `buildTakeProfitOrder` call**: The `filledSide` parameter determines the *opposite* side. Since we're rebuilding the same TP order (not flipping), we pass the opposite of the current TP side. E.g., if TP is SELL, pass BUY as `filledSide` so `buildTakeProfitOrder` returns a SELL order.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/strategies/spikebot.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/strategies/spikebot.ts test/strategies/spikebot.test.ts
git commit -m "feat(spikebot): gradual take-profit adjustment after patience window expires"
```

---

### Task 7: Tiered Recovery — Phase 3 (Abandonment at Hard Floor)

**Files:**
- Modify: `src/strategies/spikebot.ts`
- Test: `test/strategies/spikebot.test.ts`

- [ ] **Step 1: Write test — SELL take-profit abandoned when candidate <= entry price**

Add to `test/strategies/spikebot.test.ts`:

```typescript
describe('Tiered recovery: Phase 3 — Abandonment', () => {
  it('abandons SELL take-profit when adjusted price would cross entry price', async () => {
    await strategy.initialize({
      maWindow: 10, rebalanceThresholdPct: 2.0, maxReboundCycles: 5, reboundStepPct: 2.0,
      pairs: [{ symbol: 'XMT_XMD', deviationPct: 10, levels: 1, orderAmount: 20 }],
    });

    warmUpMA(strategy, 0.85, 10);
    const state = (strategy as any).pairStates[0];

    // SELL TP at 0.91, entry BUY was at 0.90
    // Adjustment: 0.91 - (0.91 * 2.0 / 100) = 0.91 - 0.0182 = 0.8918 < 0.90 entry
    state.spikeOrders = [];
    state.takeProfitOrders = [{
      orderSide: 2, price: 0.91, quantity: 20, marketSymbol: 'XMT_XMD',
      orderId: 'tp-1', entryPrice: 0.90, cyclesSincePlace: 6, originalTargetPrice: 1.0,
    }];
    state.lastOrderMA = 0.85;

    mockDexAPI.fetchLatestPrice.mockResolvedValue(0.85);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([
      { order_id: 'tp-1', price: 0.91, order_side: 2 },
    ]);

    await strategy.trade();

    // TP should be cancelled and removed
    expect(cancelOrder).toHaveBeenCalledWith('tp-1');
    expect(state.takeProfitOrders.length).toBe(0);
    // Spike orders should be placed on the next cycle (takeProfitOrders is empty now)
  });

  it('abandons BUY take-profit when adjusted price would cross entry price', async () => {
    await strategy.initialize({
      maWindow: 10, rebalanceThresholdPct: 2.0, maxReboundCycles: 5, reboundStepPct: 2.0,
      pairs: [{ symbol: 'XMT_XMD', deviationPct: 10, levels: 1, orderAmount: 20 }],
    });

    warmUpMA(strategy, 1.15, 10);
    const state = (strategy as any).pairStates[0];

    // BUY TP at 1.09, entry SELL was at 1.10
    // Adjustment: 1.09 + (1.09 * 2.0 / 100) = 1.09 + 0.0218 = 1.1118 > 1.10 entry
    state.spikeOrders = [];
    state.takeProfitOrders = [{
      orderSide: 1, price: 1.09, quantity: 20, marketSymbol: 'XMT_XMD',
      orderId: 'tp-1', entryPrice: 1.10, cyclesSincePlace: 6, originalTargetPrice: 1.0,
    }];
    state.lastOrderMA = 1.15;

    mockDexAPI.fetchLatestPrice.mockResolvedValue(1.15);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([
      { order_id: 'tp-1', price: 1.09, order_side: 1 },
    ]);

    await strategy.trade();

    expect(cancelOrder).toHaveBeenCalledWith('tp-1');
    expect(state.takeProfitOrders.length).toBe(0);
  });

  it('resumes spike order placement after abandonment', async () => {
    await strategy.initialize({
      maWindow: 10, rebalanceThresholdPct: 2.0, maxReboundCycles: 5, reboundStepPct: 2.0,
      pairs: [{ symbol: 'XMT_XMD', deviationPct: 10, levels: 1, orderAmount: 20 }],
    });

    warmUpMA(strategy, 0.85, 10);
    const state = (strategy as any).pairStates[0];

    state.spikeOrders = [];
    state.takeProfitOrders = [{
      orderSide: 2, price: 0.91, quantity: 20, marketSymbol: 'XMT_XMD',
      orderId: 'tp-1', entryPrice: 0.90, cyclesSincePlace: 6, originalTargetPrice: 1.0,
    }];
    state.lastOrderMA = 0.85;

    mockDexAPI.fetchLatestPrice.mockResolvedValue(0.85);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([
      { order_id: 'tp-1', price: 0.91, order_side: 2 },
    ]);

    await strategy.trade();

    // After abandonment, takeProfitOrders is empty, spikeOrders is empty
    // So on the NEXT trade() call, spike orders should be placed
    expect(state.takeProfitOrders.length).toBe(0);
    expect(state.spikeOrders.length).toBe(0);

    // Next cycle — fresh placement should happen
    mockDexAPI.fetchLatestPrice.mockResolvedValue(0.85);
    mockDexAPI.fetchPairOpenOrders.mockResolvedValue([]);
    vi.mocked(cancelOrder).mockClear();

    const { prepareLimitOrder } = await import('../../src/dexrpc');
    vi.mocked(prepareLimitOrder).mockClear();

    await strategy.trade();

    // Should place new spike orders
    expect(prepareLimitOrder).toHaveBeenCalled();
    expect(state.spikeOrders.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/strategies/spikebot.test.ts`
Expected: FAIL — no hard floor check exists yet

- [ ] **Step 3: Implement — add hard floor check to adjustment logic**

In the Phase 2 adjustment loop added in Task 6, replace the comment `// Hard floor check — will be implemented in Task 7` and the line below it with:

```typescript
// Hard floor check: never cross entry price
if (tracked.orderSide === ORDERSIDES.SELL && candidatePrice <= tracked.entryPrice) {
  // Would sell at or below what we bought for — abandon
  if (tracked.orderId) {
    try {
      await dexrpc.cancelOrder(String(tracked.orderId));
      await dexrpc.withdrawAll();
      await delay(2000);
    } catch (error) {
      logger.error(`[SpikeBot] Failed to cancel abandoned TP ${tracked.orderId}: ${(error as Error).message}`);
    }
  }
  logger.info(`[SpikeBot] Abandoning SELL take-profit for ${symbol}: adjusted price ${candidatePrice.toFixed(market.ask_token.precision)} would cross entry ${tracked.entryPrice}. Resuming spike orders.`);
  events.orderCancelled(`[SpikeBot] Abandoned SELL TP — would cross entry price`, {
    market: symbol,
    entryPrice: tracked.entryPrice,
    lastTargetPrice: currentPrice,
    candidatePrice,
  });
  tpOrdersChanged = true;
  continue;
}
if (tracked.orderSide === ORDERSIDES.BUY && candidatePrice >= tracked.entryPrice) {
  // Would buy at or above what we sold for — abandon
  if (tracked.orderId) {
    try {
      await dexrpc.cancelOrder(String(tracked.orderId));
      await dexrpc.withdrawAll();
      await delay(2000);
    } catch (error) {
      logger.error(`[SpikeBot] Failed to cancel abandoned TP ${tracked.orderId}: ${(error as Error).message}`);
    }
  }
  logger.info(`[SpikeBot] Abandoning BUY take-profit for ${symbol}: adjusted price ${candidatePrice.toFixed(market.ask_token.precision)} would cross entry ${tracked.entryPrice}. Resuming spike orders.`);
  events.orderCancelled(`[SpikeBot] Abandoned BUY TP — would cross entry price`, {
    market: symbol,
    entryPrice: tracked.entryPrice,
    lastTargetPrice: currentPrice,
    candidatePrice,
  });
  tpOrdersChanged = true;
  continue;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/strategies/spikebot.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/strategies/spikebot.ts test/strategies/spikebot.test.ts
git commit -m "feat(spikebot): abandon take-profit at hard floor and resume spike orders"
```

---

### Task 8: Verify Build & Full Integration

**Files:**
- All modified files

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Review persistence round-trip**

Verify that the new `TrackedOrder` fields (`entryPrice`, `cyclesSincePlace`, `originalTargetPrice`) survive serialization. The existing `saveTrackedOrders` uses `JSON.stringify` which includes all enumerable properties, and `loadTrackedOrders` uses `JSON.parse` which restores them. No code change needed — just confirm by reading `persistAllTrackedOrders()` and `loadTrackedOrders()` in `src/strategies/base.ts`.

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(spikebot): address any type or integration issues"
```

Only run this step if Steps 1-2 revealed issues that needed fixing.
