# Tier-1 / Tier-2 Refactor Summary

## Overview

The `/api/analyze` endpoint has been refactored to implement a two-phase execution model:
- **Tier-1 (Blocking)**: Fast path that returns usable Page-1 results in ≤10 seconds
- **Tier-2 (Async)**: Heavy computations that refine accuracy and run in background

## Architecture Changes

### New Files Created

1. **`types/tierContracts.ts`** - TypeScript interfaces for Tier-1 and Tier-2 data contracts
2. **`lib/estimators/tier1Estimation.ts`** - Fast estimation functions (no BSR, no calibration)
3. **`lib/estimators/tier2Refinement.ts`** - Async refinement functions (BSR, calibration, confidence)
4. **`lib/analyze/tier1Snapshot.ts`** - Tier-1 snapshot builder

### Modified Files

1. **`app/api/analyze/route.ts`** - Refactored to return Tier-1 immediately, trigger Tier-2 async

## Tier-1 Execution (≤10s)

### What Runs in Tier-1

✅ **INCLUDED:**
- Rainforest Page-1 search fetch (page=1 only)
- Fast canonicalization (dedupe ASINs, select best rank)
- HARD CAP to top 49 organic listings
- Basic field extraction (asin, title, image, price, rating, reviews, fulfillment, brand)
- Fast revenue/units estimation (rank-based, no BSR)
- Brand extraction using local heuristics (title/byline)
- Aggregation sums (total units, total revenue, averages)

❌ **EXCLUDED (Moved to Tier-2):**
- BSR fetching
- Calibration against historical multipliers
- Demand normalization & expansion
- Algorithm boost detection
- Confidence scoring
- Brand moat / dominance computation
- Snapshot integrity checks
- Helium-10 alignment checks

### Tier-1 Response Shape

```typescript
{
  success: true,
  status: "partial",
  tier: "tier1",
  snapshot: {
    snapshot_id: string,
    keyword: string,
    marketplace: 'US' | 'CA',
    tier: 'tier1',
    status: 'partial',
    phase: 'complete',
    products: Tier1Product[], // Max 49 products
    aggregates: {
      total_page1_units: number,
      total_page1_revenue: number,
      avg_price: number | null,
      avg_reviews: number | null,
      avg_rating: number | null,
    },
    created_at: string,
  },
  ui_hints: {
    show_refining_badge: true,
    next_update_expected_sec: 15,
  },
  message: "Tier-1 snapshot returned. Refinement in progress...",
}
```

## Tier-2 Execution (Async)

### What Runs in Tier-2

- BSR fetching for top 5-10 ASINs only
- Calibration + dampening models
- Recompute total revenue / units with BSR data
- Detect algorithm boosts
- Compute brand dominance + moat metrics
- Compute confidence score
- Update snapshot (status=refined)

### Tier-2 Updates

Tier-2 refinements are merged into the existing snapshot via `snapshot_id`:

```typescript
{
  snapshot_id: string,
  tier: 'tier2',
  status: 'refined',
  refinements: {
    calibrated_units?: number,
    calibrated_revenue?: number,
    confidence_score?: number,
    confidence_level?: 'low' | 'medium' | 'high',
    brand_dominance?: {
      top_5_brand_share_pct: number,
      brands: Array<{ brand: string; revenue_share_pct: number }>,
    },
    algorithm_boosts?: Array<{ asin: string; appearances: number }>,
  },
  completed_at: string,
}
```

## Execution Flow

### Phase A: Tier-1 (Sync, ≤10s)

1. Fetch Rainforest Page-1 search results
2. Fast canonicalization (dedupe ASINs)
3. HARD CAP to top 49 organic listings
4. Extract basic fields + brand (local heuristics)
5. Run Tier-1 fast estimators
6. Build Tier-1 snapshot
7. **RETURN Tier-1 snapshot immediately**

### Phase B: Tier-2 (Async, Non-blocking)

Triggered AFTER Tier-1 response is returned:

1. Fetch BSR for limited subset (top 5 ASINs)
2. Run calibration + dampening
3. Recompute totals
4. Detect algorithm boosts
5. Compute brand dominance
6. Compute confidence score
7. Update snapshot in database

## Key Constraints

✅ **ENFORCED:**
- Never exceed 49 Page-1 products (HARD CAP)
- Never block UI waiting for Tier-2
- Never hide that refinement is happening (UI hints)
- Never degrade accuracy silently (Tier-2 refines)
- All Tier-2 updates are idempotent
- UI can re-hydrate snapshot via `snapshot_id`

## Backward Compatibility

- Legacy path still works if Tier-1 fails
- Existing consumers continue to work
- Tier-1 response includes all required fields for UI
- Tier-2 updates are additive (don't break existing data)

## Next Steps

1. **UI Integration**: Update frontend to handle Tier-1 response and show refinement badge
2. **Tier-2 Persistence**: Implement database updates for Tier-2 refinements
3. **Snapshot Re-hydration**: Add endpoint to fetch refined snapshot by `snapshot_id`
4. **AI Integration**: Decide if AI analysis should be Tier-1 or Tier-2 (currently skipped in Tier-1)

## Performance Targets

- **Tier-1**: ≤10 seconds (target: 5-8 seconds)
- **Tier-2**: Runs async, no time limit
- **Total API calls**: Tier-1 uses 1-2 calls, Tier-2 uses 5-10 calls

## Logging

Key logs added:
- `TIER1_SNAPSHOT_BUILT` - When Tier-1 snapshot is created
- `TIER1_EARLY_RETURN` - When Tier-1 response is returned
- `TIER2_REFINEMENT_START` - When Tier-2 begins
- `TIER2_REFINEMENT_COMPLETE` - When Tier-2 finishes
- `TIER2_REFINEMENT_ERROR` - When Tier-2 fails (non-fatal)

