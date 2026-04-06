# Spike Bot Tiered Recovery Design

## Problem

After a spike order fills, the bot places a take-profit counter-order at the current MA price. Two bugs and a missing feature prevent this from working reliably:

1. **MA drift check is gated on `spikeOrders.length > 0`** (spikebot.ts:173) — after a spike fills and is removed from `spikeOrders`, the rebalance logic never runs again for the take-profit phase.
2. **New spike orders are placed while take-profit is outstanding** (spikebot.ts:187) — `spikeOrders.length === 0` triggers fresh placement even when a take-profit is active, over-committing capital.
3. **Take-profit orders are static** — once placed at the MA, they are never adjusted. If the MA shifts or the price doesn't return, the order sits forever.

## Design

### Bug Fixes

**Fix 1 — MA drift check**: Change the condition at line 173 from:
```
state.spikeOrders.length > 0
```
to:
```
state.spikeOrders.length > 0 || state.takeProfitOrders.length > 0
```

**Fix 2 — Prevent re-placement during take-profit**: Change the condition at line 187 from:
```
state.spikeOrders.length === 0
```
to:
```
state.spikeOrders.length === 0 && state.takeProfitOrders.length === 0
```

No new spike orders are placed while a take-profit is outstanding, to avoid over-committing capital.

### New State Tracking

Extend tracked take-profit order objects with:

- `entryPrice: number` — the price at which the spike order filled (hard floor for adjustment)
- `cyclesSincePlace: number` — how many trade cycles this take-profit has been open
- `originalTargetPrice: number` — the MA at time of placement

These fields are part of the tracked order objects and persist through crash recovery automatically.

### Tiered Recovery Logic

Inserted after existing take-profit fill detection (step 5), runs once per cycle for each unfilled take-profit order:

**Phase 1 — Patience (cycles 0 to `maxReboundCycles`)**
- Increment `cyclesSincePlace` each cycle.
- Do nothing else — let the order sit at the original MA target.
- Default `maxReboundCycles`: 20.

**Phase 2 — Gradual Adjustment (after `maxReboundCycles` exceeded)**
- Each cycle, move the take-profit price toward the current MA by `reboundStepPct` (default 0.5%).
- For a SELL take-profit: new price = current target price - (current target price * reboundStepPct / 100). Only move downward toward current MA.
- For a BUY take-profit: new price = current target price + (current target price * reboundStepPct / 100). Only move upward toward current MA.
- **Hard floor check**: before adjusting, compare the candidate price against `entryPrice`:
  - SELL take-profit: if candidate price <= entry price (the buy price), abandon.
  - BUY take-profit: if candidate price >= entry price (the sell price), abandon.

**Phase 3 — Abandonment**
- Cancel the take-profit order on-chain.
- Remove from `state.takeProfitOrders`.
- Log that the position is being accepted and spike orders will resume.
- Bot falls through to normal spike order placement on the next cycle.

**Adjustment mechanics**: Cancel the stale take-profit on-chain, withdraw, wait briefly, then place a new order at the adjusted price.

### Configuration

New optional fields in `spikeBot` config (global, not per-pair):

```json
"spikeBot": {
  "maWindow": 10,
  "rebalanceThresholdPct": 2.0,
  "maxReboundCycles": 20,
  "reboundStepPct": 0.5,
  "pairs": [...]
}
```

- `maxReboundCycles` (default 20): Trade cycles to wait before starting adjustment. At 30s interval = ~10 minutes.
- `reboundStepPct` (default 0.5): Percentage to move take-profit toward current MA each cycle after patience expires.

Both optional with defaults — existing configs are unaffected.

The `SpikeBotPair` interface is unchanged. `BotConfig['spikeBot']` gets two new optional fields.

### Persistence

No changes to persistence mechanism. New fields (`entryPrice`, `cyclesSincePlace`, `originalTargetPrice`) are properties on tracked order objects, which are already serialized to disk by `persistAllTrackedOrders()` and restored by `loadTrackedOrders()`.

### Events

Two new event emissions using the existing `events.orderFilled()` pattern:

- **Take-profit adjusted**: emitted when price is moved during Phase 2. Message includes old price, new price, and cycles elapsed.
- **Take-profit abandoned**: emitted when hard floor is hit during Phase 3. Message includes entry price, last target price, and that spike orders will resume.

## Files Changed

- `src/strategies/spikebot.ts` — bug fixes, tiered recovery logic, new state fields
- `src/interfaces/config.interface.ts` — add `maxReboundCycles?` and `reboundStepPct?` to `BotConfig['spikeBot']`
- `config/default.json` — add new config fields with defaults
