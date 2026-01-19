# SP_API_HARD_ERROR_NO_LISTINGS Analysis

## Exact Guard Clause Location

**File:** `app/api/analyze/route.ts:2263-2268`

```typescript
} else if (body.input_type === "keyword") {
  // HARD ERROR: SP-API should have run but rawListings is empty
  console.error("❌ SP_API_HARD_ERROR_NO_LISTINGS", {
    keyword: body.input_value,
    message: "SP-API MUST execute for all keyword searches. Raw listings is empty.",
  });
}
```

## Condition Being Checked

The guard clause fires when:
1. `body.input_type === "keyword"` (keyword search mode)
2. The `if (false)` block at line 1966 did NOT execute (which is always true, since it's `if (false)`)
3. This means the entire SP-API enrichment block is disabled

## What Data It Expects

The code expects:
- `page1Asins` to be defined (from line 1969, inside the disabled `if (false)` block)
- `page1Asins.length > 0` to trigger SP-API enrichment
- SP-API enrichment to happen in that block (lines 1976-2254)

## Why Data Is Missing

**Root Cause:** The entire SP-API enrichment block is disabled with `if (false)` at line 1966.

**Why it still fires even though `raw_listings_count: 70`:**
- `rawListings.length === 70` (listings exist)
- But `page1Asins` is never defined because the `if (false)` block never executes
- The code structure is:
  ```
  if (false) {
    const page1Asins = ...;  // Never executes
    if (page1Asins.length > 0) {
      // SP-API enrichment
    } else {
      // SP_API_HARD_ERROR_NO_ASINS
    }
  } else if (body.input_type === "keyword") {
    // SP_API_HARD_ERROR_NO_LISTINGS - ALWAYS FIRES
  }
  ```
- Since `if (false)` is always false, it always goes to the `else if` block
- The error message says "Raw listings is empty" but it's actually checking if the disabled block executed

## The Real Issue

SP-API enrichment is supposed to happen in `fetchKeywordMarketSnapshot` (as noted in comments), but the guard clause still checks for the disabled block. The guard clause should:
1. Check if SP-API enrichment already happened in `fetchKeywordMarketSnapshot`
2. OR be removed entirely since SP-API is handled elsewhere
3. OR check `rawListings` for SP-API source tags instead of checking a disabled block

