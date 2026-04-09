# Dashboard Spike Bot Recovery Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dashboard support for configuring and monitoring the spike bot's tiered recovery feature — config fields in create/edit modal, recovery state in the order state file, and recovery status display in the market card.

**Architecture:** Three changes: (1) extend the dashboard's Zod schema and form to include `maxReboundCycles` and `reboundStepPct`, (2) extend the bot's `OrderStateEntry` to carry recovery metadata into the state file, (3) extend the dashboard's order display to show recovery status inline in the market card.

**Tech Stack:** Next.js (App Router), React, TypeScript, Zod, Tailwind CSS

---

### File Map

| File | Repo | Action | Responsibility |
|------|------|--------|----------------|
| `src/types/instance.ts` | dex-dashboard | Modify | Add optional config fields to spikeBot schema |
| `src/components/dashboard/create-instance-modal.tsx` | dex-dashboard | Modify | Add state, inputs, load/save for new fields |
| `src/lib/api.ts` | dex-dashboard | Modify | Add RecoveryOrder interface, extend InstanceOrdersMarket |
| `src/app/api/instances/[id]/orders/route.ts` | dex-dashboard | Modify | Pass through recoveryOrders from state file |
| `src/components/dashboard/instance-monitor.tsx` | dex-dashboard | Modify | Render recovery status in market card |
| `src/strategies/base.ts` | dex-bot | Modify | Add recoveryOrders to OrderStateEntry |
| `src/strategies/spikebot.ts` | dex-bot | Modify | Include recovery data in order state entries |

---

### Task 1: Zod Schema — Add Recovery Config Fields

**Files:**
- Modify: `/Users/tayler/Developer/Protonext/dex-dashboard/src/types/instance.ts:143-147`

- [ ] **Step 1: Add optional fields to spikeBot config schema**

In `/Users/tayler/Developer/Protonext/dex-dashboard/src/types/instance.ts`, change lines 143-147 from:

```typescript
  spikeBot: z.object({
    pairs: z.array(SpikeBotPairSchema),
    maWindow: z.number().min(2).max(200),
    rebalanceThresholdPct: z.number().positive().max(50),
  }).optional(),
```

to:

```typescript
  spikeBot: z.object({
    pairs: z.array(SpikeBotPairSchema),
    maWindow: z.number().min(2).max(200),
    rebalanceThresholdPct: z.number().positive().max(50),
    maxReboundCycles: z.number().min(1).max(1000).optional(),
    reboundStepPct: z.number().positive().max(10).optional(),
  }).optional(),
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/tayler/Developer/Protonext/dex-dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /Users/tayler/Developer/Protonext/dex-dashboard
git add src/types/instance.ts
git commit -m "feat(spikebot): add maxReboundCycles and reboundStepPct to config schema"
```

---

### Task 2: Create/Edit Modal — Add Config Input Fields

**Files:**
- Modify: `/Users/tayler/Developer/Protonext/dex-dashboard/src/components/dashboard/create-instance-modal.tsx`

- [ ] **Step 1: Add state variables**

After line 121 (`const [rebalanceThresholdPct, setRebalanceThresholdPct] = useState('1.0');`), add:

```typescript
  const [maxReboundCycles, setMaxReboundCycles] = useState('20');
  const [reboundStepPct, setReboundStepPct] = useState('0.5');
```

- [ ] **Step 2: Add config loading for edit mode**

In the spike bot config loading block (around line 253-261), after:
```typescript
          setRebalanceThresholdPct(config.bot.spikeBot.rebalanceThresholdPct.toString());
```

Add:
```typescript
          if (config.bot.spikeBot.maxReboundCycles !== undefined) {
            setMaxReboundCycles(config.bot.spikeBot.maxReboundCycles.toString());
          }
          if (config.bot.spikeBot.reboundStepPct !== undefined) {
            setReboundStepPct(config.bot.spikeBot.reboundStepPct.toString());
          }
```

- [ ] **Step 3: Add fields to config building on submit**

In the spike bot config building block (around line 466-481), change the `spikeBot` object from:

```typescript
          spikeBot: {
            pairs: spikePairs.map(p => ({
              symbol: p.symbol,
              deviationPct: parseFloat(p.deviationPct),
              levels: parseInt(p.levels, 10),
              orderAmount: parseFloat(p.orderAmount),
            })),
            maWindow: parseInt(maWindow, 10),
            rebalanceThresholdPct: parseFloat(rebalanceThresholdPct),
          },
```

to:

```typescript
          spikeBot: {
            pairs: spikePairs.map(p => ({
              symbol: p.symbol,
              deviationPct: parseFloat(p.deviationPct),
              levels: parseInt(p.levels, 10),
              orderAmount: parseFloat(p.orderAmount),
            })),
            maWindow: parseInt(maWindow, 10),
            rebalanceThresholdPct: parseFloat(rebalanceThresholdPct),
            maxReboundCycles: parseInt(maxReboundCycles, 10),
            reboundStepPct: parseFloat(reboundStepPct),
          },
```

- [ ] **Step 4: Add UI input fields**

In the spike bot form section, after the existing `grid grid-cols-2 gap-4` div (which contains MA Window and Rebalance Threshold, lines 1229-1249), add a second row:

```tsx
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Max Rebound Cycles"
                type="number"
                min="1"
                max="1000"
                value={maxReboundCycles}
                onChange={(e) => setMaxReboundCycles(e.target.value)}
                required
              />
              <Input
                label="Rebound Step %"
                type="number"
                step="0.1"
                min="0.1"
                max="10"
                value={reboundStepPct}
                onChange={(e) => setReboundStepPct(e.target.value)}
                required
              />
            </div>
```

Insert this between the closing `</div>` of the first grid (line 1249) and the `{/* Per-pair config */}` comment (line 1251).

- [ ] **Step 5: Update the info box**

In the info box (lines 1336-1345), add a new list item after the "Rebalances when MA drifts" item:

```tsx
                <li>After {maxReboundCycles || 'N'} cycles without take-profit fill, adjusts price by {reboundStepPct || 'X'}% per cycle toward MA</li>
                <li>Abandons take-profit and resumes spike orders if adjustment would cross entry price</li>
```

- [ ] **Step 6: Verify build**

Run: `cd /Users/tayler/Developer/Protonext/dex-dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
cd /Users/tayler/Developer/Protonext/dex-dashboard
git add src/components/dashboard/create-instance-modal.tsx
git commit -m "feat(spikebot): add recovery config fields to create/edit modal"
```

---

### Task 3: Bot State File — Include Recovery Data

**Files:**
- Modify: `/Users/tayler/Developer/Protonext/dex-bot/src/strategies/base.ts:12-16`
- Modify: `/Users/tayler/Developer/Protonext/dex-bot/src/strategies/spikebot.ts` (orderStateEntries push)

- [ ] **Step 1: Extend OrderStateEntry**

In `/Users/tayler/Developer/Protonext/dex-bot/src/strategies/base.ts`, change lines 12-16 from:

```typescript
export interface OrderStateEntry {
  symbol: string;
  orders: OrderHistory[];
  expectedOrders: number;
}
```

to:

```typescript
export interface RecoveryOrderState {
  side: 'BUY' | 'SELL';
  price: number;
  entryPrice: number;
  originalTargetPrice: number;
  cyclesSincePlace: number;
  phase: 'patience' | 'adjusting';
}

export interface OrderStateEntry {
  symbol: string;
  orders: OrderHistory[];
  expectedOrders: number;
  recoveryOrders?: RecoveryOrderState[];
}
```

- [ ] **Step 2: Update writeOrderState to include recoveryOrders**

In `/Users/tayler/Developer/Protonext/dex-bot/src/strategies/base.ts`, in the `writeOrderState` method (around line 285-294), change the market mapping from:

```typescript
        return {
          symbol: entry.symbol,
          marketId: market?.market_id || 0,
          bidToken: market?.bid_token?.code || '',
          askToken: market?.ask_token?.code || '',
          buyOrders,
          sellOrders,
          totalOrders: entry.orders.length,
          expectedOrders: entry.expectedOrders,
        };
```

to:

```typescript
        return {
          symbol: entry.symbol,
          marketId: market?.market_id || 0,
          bidToken: market?.bid_token?.code || '',
          askToken: market?.ask_token?.code || '',
          buyOrders,
          sellOrders,
          totalOrders: entry.orders.length,
          expectedOrders: entry.expectedOrders,
          ...(entry.recoveryOrders && entry.recoveryOrders.length > 0 && {
            recoveryOrders: entry.recoveryOrders,
          }),
        };
```

- [ ] **Step 3: Build recovery data in spikebot trade()**

In `/Users/tayler/Developer/Protonext/dex-bot/src/strategies/spikebot.ts`, find the `orderStateEntries.push` call (around line 106-110). Change from:

```typescript
        orderStateEntries.push({
          symbol,
          orders: openOrders,
          expectedOrders: state.config.levels * 2,
        });
```

to:

```typescript
        const recoveryOrders: import('./base').RecoveryOrderState[] = state.takeProfitOrders
          .filter(o => o.entryPrice !== undefined && o.cyclesSincePlace !== undefined)
          .map(o => ({
            side: (o.orderSide === ORDERSIDES.BUY ? 'BUY' : 'SELL') as 'BUY' | 'SELL',
            price: o.price,
            entryPrice: o.entryPrice!,
            originalTargetPrice: o.originalTargetPrice ?? o.price,
            cyclesSincePlace: o.cyclesSincePlace!,
            phase: (o.cyclesSincePlace! > this.maxReboundCycles ? 'adjusting' : 'patience') as 'patience' | 'adjusting',
          }));

        orderStateEntries.push({
          symbol,
          orders: openOrders,
          expectedOrders: state.takeProfitOrders.length > 0
            ? state.takeProfitOrders.length
            : state.config.levels * 2,
          recoveryOrders: recoveryOrders.length > 0 ? recoveryOrders : undefined,
        });
```

Note: `expectedOrders` is adjusted — when take-profit orders are active, the expected count is the number of take-profit orders (not `levels * 2`, since spike orders aren't placed during recovery).

- [ ] **Step 4: Verify build**

Run: `cd /Users/tayler/Developer/Protonext/dex-bot && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
cd /Users/tayler/Developer/Protonext/dex-bot
git add src/strategies/base.ts src/strategies/spikebot.ts
git commit -m "feat(spikebot): include recovery order state in dashboard state file"
```

---

### Task 4: Dashboard API Types & Passthrough

**Files:**
- Modify: `/Users/tayler/Developer/Protonext/dex-dashboard/src/lib/api.ts:6-16`
- Modify: `/Users/tayler/Developer/Protonext/dex-dashboard/src/app/api/instances/[id]/orders/route.ts:97-109`

- [ ] **Step 1: Add RecoveryOrder interface and extend InstanceOrdersMarket**

In `/Users/tayler/Developer/Protonext/dex-dashboard/src/lib/api.ts`, after the existing `InstanceOrdersMarket` interface (line 16), add a new interface and modify the existing one. Change lines 6-16 from:

```typescript
export interface InstanceOrdersMarket {
  symbol: string;
  marketId: number;
  buyOrders: DexOpenOrder[];
  sellOrders: DexOpenOrder[];
  totalOrders: number;
  expectedOrders: number;
  status: 'ok' | 'warning' | 'error';
  bidToken: string;
  askToken: string;
}
```

to:

```typescript
export interface RecoveryOrder {
  side: 'BUY' | 'SELL';
  price: number;
  entryPrice: number;
  originalTargetPrice: number;
  cyclesSincePlace: number;
  phase: 'patience' | 'adjusting';
}

export interface InstanceOrdersMarket {
  symbol: string;
  marketId: number;
  buyOrders: DexOpenOrder[];
  sellOrders: DexOpenOrder[];
  totalOrders: number;
  expectedOrders: number;
  status: 'ok' | 'warning' | 'error';
  bidToken: string;
  askToken: string;
  recoveryOrders?: RecoveryOrder[];
}
```

- [ ] **Step 2: Pass through recoveryOrders in orders API route**

In `/Users/tayler/Developer/Protonext/dex-dashboard/src/app/api/instances/[id]/orders/route.ts`, in the `readOrderStateFile` function, the market mapping (around line 97-109) currently spreads the market object and adds status. The `recoveryOrders` field, if present in the state file, will already be included via the `...market` spread. Verify this by reading the code — no change needed if the spread is already there.

The current code at line 106 is:
```typescript
    }) => ({
      ...market,
      status: computeOrderStatus(market.totalOrders, market.expectedOrders),
    }));
```

The `...market` spread already passes through any extra fields including `recoveryOrders`. **No code change needed** — just verify.

- [ ] **Step 3: Verify build**

Run: `cd /Users/tayler/Developer/Protonext/dex-dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/tayler/Developer/Protonext/dex-dashboard
git add src/lib/api.ts
git commit -m "feat(spikebot): add RecoveryOrder type and extend InstanceOrdersMarket"
```

---

### Task 5: Market Card — Display Recovery Status

**Files:**
- Modify: `/Users/tayler/Developer/Protonext/dex-dashboard/src/components/dashboard/instance-monitor.tsx:258-318`

- [ ] **Step 1: Add recovery status section to expanded market card**

In `/Users/tayler/Developer/Protonext/dex-dashboard/src/components/dashboard/instance-monitor.tsx`, find the expanded section of `MarketCard` (the `{expanded && (` block starting around line 258). After the closing `</div>` of the `grid grid-cols-2 gap-4` div (which contains buy/sell orders, around line 318) and before the closing `</div>` of the expanded section, add:

```tsx
          {/* Recovery orders */}
          {market.recoveryOrders && market.recoveryOrders.length > 0 && (
            <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-2">
                <RefreshCw className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Recovery ({market.recoveryOrders.length})
                </span>
              </div>
              <div className="space-y-2">
                {market.recoveryOrders.map((recovery, idx) => {
                  const progressPct = recovery.originalTargetPrice !== recovery.entryPrice
                    ? Math.abs(recovery.originalTargetPrice - recovery.price)
                      / Math.abs(recovery.originalTargetPrice - recovery.entryPrice) * 100
                    : 0;

                  return (
                    <div
                      key={idx}
                      className="text-xs p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                          recovery.side === 'BUY'
                            ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                            : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                        }`}>
                          {recovery.side} TP
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                          recovery.phase === 'patience'
                            ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300'
                            : 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300'
                        }`}>
                          {recovery.phase === 'patience'
                            ? `Waiting (${recovery.cyclesSincePlace} cycles)`
                            : `Adjusting (${recovery.cyclesSincePlace} cycles)`
                          }
                        </span>
                      </div>
                      <div className="flex justify-between text-gray-600 dark:text-gray-400">
                        <span>TP: {recovery.price.toFixed(6)}</span>
                        <span>Entry: {recovery.entryPrice.toFixed(6)}</span>
                      </div>
                      <div className="mt-1.5">
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                          <div
                            className="bg-blue-500 h-1.5 rounded-full transition-all"
                            style={{ width: `${Math.min(progressPct, 100)}%` }}
                          />
                        </div>
                        <div className="flex justify-between mt-0.5 text-[10px] text-gray-400">
                          <span>Target: {recovery.originalTargetPrice.toFixed(6)}</span>
                          <span>Floor: {recovery.entryPrice.toFixed(6)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
```

- [ ] **Step 2: Add RefreshCw import**

At the top of the file, find the lucide-react import line and add `RefreshCw` to it. For example, if the current import is:

```typescript
import { CheckCircle, AlertTriangle, XCircle, TrendingUp, TrendingDown, ChevronDown } from 'lucide-react';
```

Change to:

```typescript
import { CheckCircle, AlertTriangle, XCircle, TrendingUp, TrendingDown, ChevronDown, RefreshCw } from 'lucide-react';
```

(Read the actual import line first to get the exact current set of imports.)

- [ ] **Step 3: Verify build**

Run: `cd /Users/tayler/Developer/Protonext/dex-dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/tayler/Developer/Protonext/dex-dashboard
git add src/components/dashboard/instance-monitor.tsx
git commit -m "feat(spikebot): display recovery status in market card"
```

---

### Task 6: Final Verification

- [ ] **Step 1: Type check both repos**

Run: `cd /Users/tayler/Developer/Protonext/dex-bot && npx tsc --noEmit`
Run: `cd /Users/tayler/Developer/Protonext/dex-dashboard && npx tsc --noEmit`
Expected: No errors in either

- [ ] **Step 2: Run bot tests**

Run: `cd /Users/tayler/Developer/Protonext/dex-bot && npx vitest run test/strategies/spikebot.test.ts`
Expected: All 13 tests pass

- [ ] **Step 3: Visual check of dashboard** (manual)

Start the dashboard dev server and verify:
- Create instance modal shows "Max Rebound Cycles" and "Rebound Step %" fields for spike bot strategy
- Info box includes recovery explanation text
- Edit mode loads existing recovery config values
