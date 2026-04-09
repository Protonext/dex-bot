# Dashboard Spike Bot Recovery Support Design

## Problem

The dex-dashboard doesn't support the new spike bot tiered recovery features:
1. Config schema doesn't include `maxReboundCycles` or `reboundStepPct`
2. Create/edit modal has no fields for these settings
3. The bot's order state file doesn't include recovery metadata
4. The order display doesn't show take-profit recovery status

## Design

### Config Schema & Form

**Zod schema** (`dex-dashboard/src/types/instance.ts`): Add two optional fields to the `spikeBot` object in `BotConfigSchema`:

```typescript
spikeBot: z.object({
  pairs: z.array(SpikeBotPairSchema),
  maWindow: z.number().min(2).max(200),
  rebalanceThresholdPct: z.number().positive().max(50),
  maxReboundCycles: z.number().min(1).max(1000).optional(),
  reboundStepPct: z.number().positive().max(10).optional(),
}).optional(),
```

**Create/edit modal** (`dex-dashboard/src/components/dashboard/create-instance-modal.tsx`):
- Two new state variables: `maxReboundCycles` (default `'20'`), `reboundStepPct` (default `'0.5'`)
- Two new input fields in the global settings grid, below existing MA Window and Rebalance Threshold
- Load from config when editing an existing instance
- Include in config object when submitting
- Follows the exact pattern of `maWindow` and `rebalanceThresholdPct`

### Bot State File Enhancement

**Bot-side** (`dex-bot/src/strategies/spikebot.ts`): Enhance the order state written by `writeOrderState()` to include recovery metadata. Add a `recoveryOrders` array to each market's state object:

```typescript
interface RecoveryOrderState {
  side: 'BUY' | 'SELL';
  price: number;          // current TP target price
  entryPrice: number;     // spike fill price (hard floor)
  originalTargetPrice: number;  // MA at TP placement
  cyclesSincePlace: number;
  phase: 'patience' | 'adjusting';
}
```

The `phase` is computed: `"patience"` if `cyclesSincePlace <= maxReboundCycles`, `"adjusting"` otherwise.

Existing `buyOrders`/`sellOrders` arrays are unchanged. Recovery info is supplementary.

**Dashboard API** (`dex-dashboard/src/app/api/instances/[id]/orders/route.ts`): Pass through the `recoveryOrders` array from the state file into the API response.

**Dashboard types** (`dex-dashboard/src/lib/api.ts`): Add `RecoveryOrder` interface and optional `recoveryOrders?: RecoveryOrder[]` field to `InstanceOrdersMarket`.

### Order Display Enhancement

**Market card** (`dex-dashboard/src/components/dashboard/instance-monitor.tsx`): When a market has `recoveryOrders`, render them in the expandable order section below buy/sell order lists:

- Side badge (BUY/SELL) using existing badge style
- Current TP price and entry price (e.g., "TP: 0.99 | Entry: 0.90")
- Phase indicator: "Waiting (5/20)" during patience, "Adjusting (25 cycles)" during Phase 2
- Subtle progress element showing how far TP price has moved from `originalTargetPrice` toward `entryPrice`

If there are no recovery orders, nothing extra renders.

**Expected orders**: The dashboard uses the `expectedOrders` value the bot writes to the state file. During take-profit phase, the bot already writes the correct expected count (spike orders aren't active, so expected count reflects current state).

## Files Changed

### dex-bot (working dir: /Users/tayler/Developer/Protonext/dex-bot)
- `src/strategies/spikebot.ts` — add recoveryOrders to order state entries

### dex-dashboard (working dir: /Users/tayler/Developer/Protonext/dex-dashboard)
- `src/types/instance.ts` — add optional config fields to spikeBot schema
- `src/components/dashboard/create-instance-modal.tsx` — add state, inputs, load/save for new fields
- `src/lib/api.ts` — add RecoveryOrder interface, extend InstanceOrdersMarket
- `src/app/api/instances/[id]/orders/route.ts` — pass through recoveryOrders
- `src/components/dashboard/instance-monitor.tsx` — render recovery status in market card
