# Enrichment State Tracking Redesign Proposal

## Goal
Make enrichment state **monotonic and non-destructive** - once a signal is confirmed, it can NEVER be invalidated later.

## Current Problems

1. **Destructive Validation:** BSR can be nulled by guard clauses after SP-API extraction
2. **Counter-Based Inference:** Success/failure inferred from `enriched_count` or `items.length`
3. **Inconsistent Source Tags:** `bsr_source` can be `'sp_api'` or `'sp_api_catalog'` inconsistently
4. **Signal Fragmentation:** SP-API signals scattered across multiple properties

## Proposed Solution

### 1. Single `enrichment_signals` Object Per ASIN

**Location:** Attached to each `ParsedListing` as `(listing as any).enrichment_signals`

**Structure:**
```typescript
interface EnrichmentSignals {
  sp_api: {
    called: boolean;           // TRUE if SP_API_REQUEST was sent
    responded: boolean;        // TRUE if SP_API_RESPONSE received
    bsr_extracted: boolean;    // TRUE if SP_API_BSR_EXTRACTED logged
    has_salesRanks: boolean;   // TRUE if salesRanks array exists
    has_classificationRanks: boolean;  // TRUE if classificationRanks exist
    has_attributes: boolean;   // TRUE if attributes_written > 0
    has_images: boolean;       // TRUE if images_written > 0
    bsr_source: 'sp_api' | 'sp_api_catalog' | null;
    brand_source: 'sp_api' | 'sp_api_catalog' | null;
    title_source: 'sp_api' | 'sp_api_catalog' | null;
    category_source: 'sp_api' | 'sp_api_catalog' | null;
    last_request_time: string | null;  // ISO timestamp
    last_response_time: string | null; // ISO timestamp
  };
  pricing: {
    called: boolean;
    responded: boolean;
    fulfillment_source: 'sp_api_pricing' | null;
    buy_box_source: 'sp_api_pricing' | null;
    last_request_time: string | null;
    last_response_time: string | null;
  };
}
```

**Benefits:**
- Single source of truth for enrichment state
- Monotonic: signals can only be set to `true`, never back to `false`
- All SP-API signals in one place
- Easy to query and validate

### 2. Deterministic Rule for SP-API Success

**Rule:**
```typescript
const spApiCalled = (signals: EnrichmentSignals): boolean => {
  return signals.sp_api.called || 
         signals.sp_api.responded || 
         signals.sp_api.bsr_extracted ||
         signals.sp_api.has_salesRanks ||
         signals.sp_api.has_classificationRanks ||
         signals.sp_api.has_attributes ||
         !!signals.sp_api.bsr_source ||
         !!signals.sp_api.brand_source ||
         !!signals.sp_api.title_source ||
         !!signals.sp_api.category_source;
};
```

**Properties:**
- **Monotonic:** Once any signal is `true`, `spApiCalled` is always `true`
- **Comprehensive:** Checks all possible SP-API signals
- **No Counter-Based:** Doesn't rely on `enriched_count` or `items.length`
- **Deterministic:** Same inputs always produce same output

### 3. Where Reconciliation Happens (MUST happen)

**Location 1: SP-API Response Handler**
- **File:** `lib/spapi/catalogItems.ts:fetchBatch()`
- **Action:** Set `enrichment_signals.sp_api.*` when SP-API responds
- **When:** Immediately after `SP_API_RESPONSE` event

**Location 2: BSR Extraction**
- **File:** `lib/spapi/catalogItems.ts:370` (where `SP_API_BSR_EXTRACTED` logs)
- **Action:** Set `enrichment_signals.sp_api.bsr_extracted = true`
- **When:** When BSR is extracted from salesRanks/classificationRanks

**Location 3: Metadata Merge**
- **File:** `lib/amazon/keywordMarket.ts:2070-2120`
- **Action:** Preserve `enrichment_signals` when merging SP-API data
- **When:** When merging catalog results into listings

**Location 4: Final Validation**
- **File:** `app/api/analyze/route.ts:2508` (determineSpApiCalled)
- **Action:** Use `enrichment_signals` instead of scattered source tags
- **When:** Before canonicalization

### 4. Where Reconciliation Must NOT Happen

**Forbidden Locations:**
1. ❌ **Rainforest Metadata Blocking Guard** (`app/api/analyze/route.ts:2126-2167`)
   - **Current:** Nulls BSR if `bsr_source !== 'sp_api_catalog'`
   - **Should:** Only null if `enrichment_signals.sp_api.bsr_extracted === false`

2. ❌ **Duplicate BSR Detection** (`lib/amazon/canonicalPageOne.ts:2295-2304`)
   - **Current:** Nulls BSR if duplicate detected
   - **Should:** Mark as duplicate but preserve signal (use `bsr_invalid_reason`)

3. ❌ **Canonical Builder** (`lib/amazon/canonicalPageOne.ts`)
   - **Current:** May mutate source tags
   - **Should:** Preserve `enrichment_signals` intact

### 5. Log Design

**Standard Enrichment Log:**
```typescript
console.log("SP_API_ENRICHMENT_STATE", {
  asin,
  signals: enrichment_signals.sp_api,
  sp_api_called: spApiCalled(enrichment_signals),
  bsr: listing.bsr || listing.main_category_bsr || null,
  brand: listing.brand || null,
  timestamp: new Date().toISOString(),
});
```

**Reconciliation Log (Current):**
```typescript
console.log("SP_API_ENRICHMENT_RECONCILIATION", {
  asin,
  brand,
  brand_source,
  bsr,
  had_sp_api_response: spApiCalled(enrichment_signals),
  had_bsr: !!(bsr !== null && bsr > 0),
  signals: enrichment_signals.sp_api,  // Full signal state
  timestamp: new Date().toISOString(),
});
```

**Error Log (When SP-API Not Called):**
```typescript
console.error("❌ SP_API_EXPECTED_BUT_NOT_CALLED", {
  asin,
  signals: enrichment_signals.sp_api,
  sp_api_called: false,
  message: "No SP-API signals detected - request may not have been sent",
});
```

## Implementation Plan

### Phase 1: Add `enrichment_signals` Object (Non-Breaking)
1. Define `EnrichmentSignals` interface
2. Initialize `enrichment_signals` in listing creation
3. Populate signals during SP-API enrichment (parallel to existing code)

### Phase 2: Migrate Validation to Use Signals (Non-Breaking)
1. Update `determineSpApiCalled()` to use `enrichment_signals`
2. Keep existing source tag checks as fallback
3. Log both for comparison

### Phase 3: Remove Destructive Logic (Breaking - Require Testing)
1. Update Rainforest blocking guard to check `enrichment_signals`
2. Make duplicate BSR detection non-destructive (preserve signals)
3. Remove counter-based inference logic

### Phase 4: Make Source Tags Derived (Cleanup)
1. Derive `bsr_source` from `enrichment_signals.sp_api.bsr_extracted`
2. Remove redundant source tag checks
3. Consolidate to single source of truth

## Benefits

1. **Monotonic State:** Signals can only be set, never unset
2. **No Counter-Based Inference:** Success determined by factual signals only
3. **Single Source of Truth:** All enrichment state in one place
4. **Debugging:** Easy to see exactly what happened with SP-API
5. **Validation:** Simple boolean check (`spApiCalled(signals)`)
6. **Non-Destructive:** BSR can't be nulled after extraction

## Migration Path

**Step 1:** Add `enrichment_signals` alongside existing source tags (both tracked)
**Step 2:** Update validation to prefer `enrichment_signals` but fall back to source tags
**Step 3:** Update all enrichment handlers to populate `enrichment_signals`
**Step 4:** Remove destructive guard clauses (use signals instead)
**Step 5:** Remove source tags (derive from signals if needed for backward compat)

## Example: Flow with New Design

```
1. SP-API Request Sent
   → enrichment_signals.sp_api.called = true
   → enrichment_signals.sp_api.last_request_time = timestamp

2. SP-API Response Received
   → enrichment_signals.sp_api.responded = true
   → enrichment_signals.sp_api.last_response_time = timestamp

3. BSR Extracted (if salesRanks exist)
   → enrichment_signals.sp_api.bsr_extracted = true
   → enrichment_signals.sp_api.has_salesRanks = true
   → enrichment_signals.sp_api.has_classificationRanks = true (if present)
   → enrichment_signals.sp_api.bsr_source = 'sp_api_catalog'

4. Validation Check
   → spApiCalled(enrichment_signals) → TRUE (bsr_extracted = true)
   → NO ERROR - SP-API was called

5. Guard Clause Check (Rainforest Blocking)
   → if (enrichment_signals.sp_api.bsr_extracted === false && listing.bsr) {
        // Only null if SP-API didn't extract BSR
        listing.bsr = null;
     }
   → BSR preserved because bsr_extracted = true ✅
```

## Backward Compatibility

- Keep existing source tags during migration
- Derive source tags from `enrichment_signals` if needed
- Both validation paths active during transition
- Remove source tags only after full migration

