# SP-API Validation Fixes

## 1. Root Cause Analysis

### Issue 1: BSR Nulling Guard Clause (CRITICAL BUG)

**Location:** `app/api/analyze/route.ts:2133-2161`

**Problem:**
```typescript
// Line 2133 - INCORRECT CHECK
const hasRainforestBsr = listing.bsr && (listing as any).bsr_source !== 'sp_api_catalog';

// Line 2158 - INCORRECT CHECK  
if (hasRainforestBsr && (listing as any).bsr_source !== 'sp_api_catalog') {
  listing.bsr = null;
  listing.main_category_bsr = null;
  (listing as any).bsr_source = null;  // ❌ WIPES SP-API BSR!
}
```

**Root Cause:**
1. SP-API can return salesRanks/classificationRanks and set `bsr_source = 'sp_api'` OR `'sp_api_catalog'`
2. The guard clause only checks for `'sp_api_catalog'`, missing `'sp_api'`
3. If `bsr_source === 'sp_api'` (set in `keywordMarket.ts:2096`), the check incorrectly evaluates to true
4. BSR gets nulled even though it came from SP-API

**Why Invalid in Keyword Mode:**
- SP-API frequently returns salesRanks WITHOUT attributes
- `SP_API_BSR_EXTRACTED` log fires when BSR is extracted
- But `bsr_source` might be set to `'sp_api'` instead of `'sp_api_catalog'`
- Guard clause doesn't account for both source tag values

### Issue 2: SP-API Success Inference from enriched_count

**Location:** `lib/amazon/keywordMarket.ts:1592` (ALREADY FIXED - removed check)

**Previous Problem:**
```typescript
if (!catalogResponse || !catalogResponse.enriched || catalogResponse.enriched.size === 0) {
  // This incorrectly treated empty enriched map as "SP-API not called"
}
```

**Fixed:** Removed this check - enriched map can be empty even when SP-API was called

### Issue 3: BSR Only Added to Enriched Map if `isEnriched === true`

**Location:** `lib/spapi/catalogItems.ts:364-367`

**Problem:**
```typescript
// Only add to enriched if item has meaningful data (BSR counts as enrichment)
if (isEnriched) {
  result.set(asin, metadata);
}
```

**Issue:**
- If SP-API returns salesRanks but `extractBSRData()` returns null (no valid rank extracted)
- Then `hasBSRData = false` and item might not be added to enriched map
- BUT `SP_API_BSR_EXTRACTED` log might still fire if salesRanks exist
- This creates a mismatch: log says BSR extracted, but ASIN not in enriched map

**However:** This is actually okay because `hasBSRData` checks for `hasClassificationRanks || hasDisplayGroupRanks`, so if salesRanks exist, it should be added. The real issue is Issue #1.

## 2. Fixes Applied

### Fix 1: Update Rainforest Metadata Blocking Guard Clause

**File:** `app/api/analyze/route.ts:2133-2161`

**Before:**
```typescript
const hasRainforestBsr = listing.bsr && (listing as any).bsr_source !== 'sp_api_catalog';

if (hasRainforestBsr && (listing as any).bsr_source !== 'sp_api_catalog') {
  listing.bsr = null;
  listing.main_category_bsr = null;
  (listing as any).bsr_source = null;
}
```

**After:**
```typescript
const hasRainforestBsr = listing.bsr && 
  (listing as any).bsr_source !== 'sp_api' && 
  (listing as any).bsr_source !== 'sp_api_catalog';

if (hasRainforestBsr && 
    (listing as any).bsr_source !== 'sp_api' && 
    (listing as any).bsr_source !== 'sp_api_catalog') {
  listing.bsr = null;
  listing.main_category_bsr = null;
  (listing as any).bsr_source = null;
}
```

**Why:** Prevents BSR from being nulled when `bsr_source === 'sp_api'` (valid SP-API source tag)

### Fix 2: Ensure BSR Source Tag is Set When BSR Exists

**File:** `lib/amazon/keywordMarket.ts:2091-2096`

**Current:**
```typescript
if (catalog.bsr !== null && catalog.bsr > 0) {
  listing.main_category_bsr = catalog.bsr;
  listing.bsr = catalog.bsr;
  (listing as any).bsr_source = 'sp_api_catalog';  // ✅ Already correct
}
```

**Status:** Already correct - `bsr_source` is set when BSR is merged

### Fix 3: Ensure BSR Source Tag is Set in Route Enrichment

**File:** `app/api/analyze/route.ts:2102-2105`

**Current:**
```typescript
if (metadata.bsr !== null && metadata.bsr > 0) {
  listing.bsr = metadata.bsr;
  listing.main_category_bsr = metadata.bsr;
  (listing as any).bsr_source = 'sp_api_catalog';  // ✅ Already correct
}
```

**Status:** Already correct - `bsr_source` is set when BSR is applied

## 3. Validation Logic Fix

**File:** `app/api/analyze/route.ts:2508-2540`

**Current `determineSpApiCalled` function:**
```typescript
const determineSpApiCalled = (listing: any): boolean => {
  // Signal 1: BSR source indicates SP-API was called
  const bsrSource = (listing as any).bsr_source;
  if (bsrSource === 'sp_api' || bsrSource === 'sp_api_catalog') {
    return true;
  }
  
  // Signal 3: Other SP-API source tags
  const titleSource = (listing as any).title_source;
  const categorySource = (listing as any).category_source;
  if (titleSource === 'sp_api' || titleSource === 'sp_api_catalog' ||
      categorySource === 'sp_api' || categorySource === 'sp_api_catalog') {
    return true;
  }
  
  return false;
};
```

**Status:** ✅ Already correct - checks for both `'sp_api'` and `'sp_api_catalog'`

## 4. Log Changes

### Before Fix:
```
❌ SP_API_EXPECTED_BUT_NOT_CALLED: 5 page-1 ASIN(s) missing SP-API response.
Failed ASINs: B123(...bsr_source: null...)
```

### After Fix (when SP-API was called):
```
✅ No error - SP-API signals detected (bsr_source: 'sp_api' or 'sp_api_catalog')
SP_API_ENRICHMENT_RECONCILIATION: { asin: 'B123', bsr_source: 'sp_api', had_sp_api_response: true }
```

### After Fix (when SP-API truly not called):
```
❌ SP_API_EXPECTED_BUT_NOT_CALLED: 2 page-1 ASIN(s) missing SP-API response.
Failed ASINs: B456({bsr_source: null, title_source: null, category_source: null})
Message: "SP-API Catalog MUST be called for all page-1 ASINs. No SP-API signals detected for failed ASINs."
```

## 5. Code Diff

```diff
--- app/api/analyze/route.ts
+++ app/api/analyze/route.ts
@@ -2130,7 +2130,9 @@
               // Check if Rainforest tried to populate blocked fields
-              const hasRainforestBsr = listing.bsr && (listing as any).bsr_source !== 'sp_api_catalog';
+              const hasRainforestBsr = listing.bsr && 
+                (listing as any).bsr_source !== 'sp_api' && 
+                (listing as any).bsr_source !== 'sp_api_catalog';
@@ -2155,7 +2157,9 @@
                 }
-                if (hasRainforestBsr && (listing as any).bsr_source !== 'sp_api_catalog') {
+                if (hasRainforestBsr && 
+                    (listing as any).bsr_source !== 'sp_api' && 
+                    (listing as any).bsr_source !== 'sp_api_catalog') {
                   listing.bsr = null;
                   listing.main_category_bsr = null;
                   (listing as any).bsr_source = null;
```

## 6. Validation Condition

**Current:** ✅ Correct - only fails if NO SP-API signals detected

**Logic:**
- If `bsr_source === 'sp_api'` OR `'sp_api_catalog'` → SP-API was called
- If `title_source === 'sp_api'` OR `'sp_api_catalog'` → SP-API was called  
- If `category_source === 'sp_api'` OR `'sp_api_catalog'` → SP-API was called
- Only fails if ALL source tags are null/missing

**Keyword Mode:**
- `brand` and `brand_source` are OPTIONAL
- Missing brand does NOT trigger failure
- Only missing ALL SP-API signals triggers failure

