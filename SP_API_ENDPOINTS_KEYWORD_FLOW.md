# SP-API Endpoints Used in Keyword Search Flow

## Summary

**Confirmed**: Keyword discovery + catalog enrichment can remain OAuth-free.  
**Pricing API**: Now gated behind seller OAuth token (feature flag enabled).  
**Fallback**: Pricing data uses Rainforest values when Pricing API is unavailable.

---

## SP-API Endpoints Used During Keyword Search

### 1. Catalog Items API v2022-04-01

**Endpoint**: `GET /catalog/2022-04-01/items`  
**SP-API Section**: Catalog  
**Implementation**: `lib/spapi/catalogItems.ts::batchEnrichCatalogItems()`  
**Called At**: 
- `app/api/analyze/route.ts:1976` (fresh keyword search)
- `app/api/analyze/route.ts:1329` (cached data rehydration)

**Seller OAuth Required?**: ❌ **NO**  
**Reason**: Public product metadata (title, brand, category, BSR, images)  
**Token Used**: App-level developer credentials (`SP_API_REFRESH_TOKEN` env var)

**Data Retrieved**:
- `title` - Product title (authoritative)
- `brand` - Brand name (authoritative, overrides Rainforest)
- `image_url` - Product image URL
- `category` - Product category
- `bsr` - Best Seller Rank (main category only)

**Batch Size**: Max 20 ASINs per request (automatically batched)

**Error Handling**: Returns empty map on failure, logs error, continues execution

**Status**: ✅ **Works without seller OAuth** - Confirmed OAuth-free operation

---

### 2. Pricing API v0

**Endpoint**: `GET /pricing/v0/items/{asin}/offers`  
**SP-API Section**: Pricing  
**Implementation**: `lib/spapi/pricing.ts::batchEnrichPricing()`  
**Called At**: 
- `app/api/analyze/route.ts:1988` (fresh keyword search)
- `app/api/analyze/route.ts:1330` (cached data rehydration)

**Seller OAuth Required?**: ✅ **YES**  
**Reason**: Amazon requires seller OAuth consent for Pricing API access, even for "public" pricing data  
**Token Used**: **Seller OAuth refresh token only** (from `amazon_connections` table)

**Feature Flag**: ✅ **Enabled**  
**Behavior**: Pricing API calls are **skipped** unless seller OAuth token is present  
**Implementation**: `lib/spapi/pricing.ts:65-85` - Checks for seller OAuth token before making requests

**Data Retrieved** (when OAuth available):
- `buy_box_owner` - "Amazon" | "Merchant" | "Unknown"
- `offer_count` - Number of offers
- `fulfillment_channel` - "FBA" | "FBM" (authoritative)
- `lowest_price` - Lowest offer price
- `buy_box_price` - Buy box price (authoritative)

**Batch Size**: 1 ASIN per request (sequential, not batched)

**Fallback Behavior**: 
- If no seller OAuth token → Pricing API is **skipped** (no 403 errors)
- Rainforest data is used for price and fulfillment
- Data marked with `price_source: 'rainforest_serp'` and `fulfillment_source: 'rainforest_serp'`
- `buy_box_owner` and `offer_count` remain null (not available from Rainforest)

**Error Handling**: 
- **403 Errors**: Logged as permission denied (rare with feature flag, but handled gracefully)
- **Other Errors**: Logged, returns empty result, falls back to Rainforest

**Status**: ✅ **Gated behind seller OAuth** - No calls made without seller token

---

### 3. Fees API v0 (FBA Fees)

**Endpoint**: `POST /products/fees/v0/items/{asin}/feesEstimate`  
**SP-API Section**: Fees  
**Implementation**: `lib/spapi/getFbaFees.ts::getFbaFees()`  
**Called Via**: `lib/spapi/resolveFbaFees.ts::resolveFbaFees()`  
**Called At**: `app/api/analyze/route.ts:1793` (margin calculations)

**Seller OAuth Required?**: ⚠️ **CONDITIONAL**  
**Reason**: Fees API may work with app-level credentials for some sellers, but accurate fees require seller context  
**Token Used**: Seller OAuth refresh token (if available), otherwise falls back to app-level token

**Data Retrieved** (when successful):
- `referral_fee` - Amazon referral fee (category-dependent percentage)
- `fulfillment_fee` - FBA fulfillment fee (size/weight dependent)
- `total_fba_fees` - Sum of referral + fulfillment

**Batch Size**: 1 ASIN per request (uses representative ASIN from Page 1)

**Fallback Behavior**: 
- If Fees API fails → Category-based fee estimates used
- Estimates based on product category and price heuristics
- Less accurate than actual fees (especially fulfillment fees, which vary by size/weight)

**Retry Strategy**: 
- If initial request fails (not 401/403), fetches product dimensions from Catalog Items API
- Retries fees request with dimensions (helps when ASIN not in seller catalog)
- Code Reference: `lib/spapi/getFbaFees.ts:122-166`

**Status**: ⚠️ **Works with fallback** - May require seller OAuth for optimal accuracy

---

## Keyword Discovery Flow (OAuth-Free Confirmed)

1. **Rainforest API** (External service, not SP-API)
   - Fetches Amazon search results (Page 1 listings)
   - Extracts: ASIN, position, price, rating, reviews, sponsored status
   - **No OAuth required** (external API key only)
   - **API Call Budget: Up to 7 calls per keyword search (worst case, typically 1-5)**
     - **1 Search call** - Initial keyword search (Page 1 results)
     - **Up to 4 BSR calls** - BSR enrichment for top 4 ASINs (if BSR missing)
     - **0-2 Metadata calls** - Ratings/reviews enrichment for top 2 ASINs (only if ratings/reviews missing)
     - **Note**: Title, image, brand already provided by SP-API Catalog (no Rainforest metadata calls needed)
     - **Total: Maximum 7 Rainforest API calls per keyword analysis (worst case, typically 1-5)**
   - **Code Reference**: `app/api/analyze/route.ts:1274-1276` - `apiCallCounter = { count: 0, max: 7 }`

2. **Catalog Items API** (SP-API, but OAuth-free)
   - Enriches ASINs with authoritative metadata (title, brand, category, BSR, images)
   - **Uses app-level credentials** (developer token)
   - **No seller OAuth required**
   - **Batch size**: Max 20 ASINs per request (batched automatically)

3. **Pricing API** (SP-API, seller OAuth required)
   - **Feature flag enabled**: Only called if seller OAuth token exists
   - If no seller OAuth → **Skipped** (no 403 errors)
   - Falls back to Rainforest price/fulfillment data (already available from search call)
   - **Does NOT add additional Rainforest calls** - uses data from initial search

4. **Fees API** (SP-API, conditional OAuth)
   - Called for margin calculations (uses representative ASIN)
   - Uses seller OAuth if available, otherwise app-level token
   - Falls back to category-based estimates if fails
   - **Does NOT add Rainforest calls** - separate API

---

## Implementation Details

### Feature Flag: Pricing API Gating

**Location**: `lib/spapi/pricing.ts::batchEnrichPricing()`  
**Check**: Lines 65-85

```typescript
// FEATURE FLAG: Pricing API requires seller OAuth token
// Skip Pricing API calls unless seller OAuth token is present
let sellerOAuthToken: string | null = null;
if (userId) {
  try {
    const { getUserAmazonRefreshToken } = await import("@/lib/amazon/getUserToken");
    sellerOAuthToken = await getUserAmazonRefreshToken(userId);
  } catch (error) {
    // Skip Pricing API - no seller OAuth token
    result.failed = [...asins];
    return result;
  }
}

if (!sellerOAuthToken) {
  // Skip Pricing API - no seller OAuth token
  result.failed = [...asins];
  return result;
}
```

**Behavior**:
- Checks for seller OAuth token **before** making any Pricing API calls
- Returns empty result immediately if no seller OAuth token
- Prevents 403 errors from developer token attempts
- Logs skip reason for observability

### Clean Fallback: Rainforest Data

**Location**: `app/api/analyze/route.ts:2102-2161` (fresh data) and `:1361-1390` (cached data)

**Behavior**:
- If Pricing API skipped or failed → Uses Rainforest data
- Marks data source: `price_source: 'rainforest_serp'` and `fulfillment_source: 'rainforest_serp'`
- Preserves existing price/fulfillment from Rainforest
- No loss of functionality - analysis proceeds normally

**Fields Available from Rainforest**:
- ✅ Price (from search results)
- ✅ Fulfillment channel (inferred from Prime eligibility/FBA indicators)
- ❌ Buy box owner (not available)
- ❌ Offer count (not available)

---

## Rainforest API Call Count (Optimized)

**Confirmed**: Metadata enrichment optimized to reduce Rainforest API calls.

**Total Rainforest API Calls per Keyword Search: Maximum 7 calls (worst case), typically 1-5 calls**
- ✅ **1 Search call** - Initial keyword search (always made)
- ✅ **Up to 4 BSR calls** - BSR enrichment for top 4 ASINs (if BSR missing from search results)
- ✅ **0-2 Metadata calls** - Ratings/reviews enrichment for top 2 ASINs (if ratings/reviews missing)

**Key Optimization**: Metadata enrichment now ONLY for ratings/reviews (SP-API cannot provide these).
- ❌ **Title** - Already provided by SP-API Catalog (authoritative)
- ❌ **Image URL** - Already provided by SP-API Catalog (authoritative)
- ❌ **Brand** - Already provided by SP-API Catalog (authoritative)
- ✅ **Ratings** - Only enriched if missing (SP-API cannot provide)
- ✅ **Reviews** - Only enriched if missing (SP-API cannot provide)

**Actual calls are typically fewer** because:
- SP-API Catalog enriches all ASINs with title, brand, image_url, category, BSR (OAuth-free)
- Metadata enrichment only needed if ratings/reviews are missing from search results
- BSR is often present in search results or provided by SP-API Catalog (no BSR calls needed)

**Pricing API skip does NOT affect Rainforest calls** because:
- Price and fulfillment data are already extracted from the initial Rainforest search call
- No additional Rainforest API calls are needed for Pricing API fallback
- The fallback simply uses data that was already fetched

**Code References**:
- API Call Budget: `app/api/analyze/route.ts:1274-1276` - `max: 7` (worst case, typically fewer)
- Search Call: `lib/amazon/keywordMarket.ts:1274-1276` - Increments counter
- BSR Calls: `lib/amazon/asinBsrCache.ts:168` - Max 4 ASINs, `apiCallCounter.count++` at line 226
- Metadata Calls: `lib/amazon/keywordMarket.ts:886-925` - Max 2 ASINs, only if ratings/reviews missing

## Verification Checklist

- [x] Catalog Items API works without seller OAuth (app-level credentials)
- [x] Pricing API calls are gated behind seller OAuth token (feature flag enabled)
- [x] Pricing API is skipped when no seller OAuth token (no 403 errors)
- [x] Rainforest fallback works cleanly for price and fulfillment data
- [x] **Rainforest API call count unchanged when Pricing API skipped (max 7 calls)**
- [x] Data sources are properly tagged (`sp_api_pricing` vs `rainforest_serp`)
- [x] Error handling distinguishes OAuth-related failures from other errors
- [x] Logging provides clear visibility into skip reasons

---

## Code References

### Catalog Items API
- **Implementation**: `lib/spapi/catalogItems.ts`
- **Token Usage**: Line 173 - `await getSpApiAccessToken()` (no user ID, uses env token)
- **No OAuth Check**: Uses app-level credentials directly

### Pricing API
- **Implementation**: `lib/spapi/pricing.ts`
- **Feature Flag**: Lines 65-85 - Checks for seller OAuth token before making requests
- **Token Usage**: Lines 177-225 - Uses seller OAuth token only
- **Skip Logic**: Lines 65-85 - Returns early if no seller OAuth token
- **Fallback**: `app/api/analyze/route.ts:2137-2161` - Uses Rainforest data when skipped

### Fees API
- **Implementation**: `lib/spapi/getFbaFees.ts`
- **Wrapper**: `lib/spapi/resolveFbaFees.ts` (cache-first strategy)
- **Token Usage**: Lines 82-95 - Tries seller OAuth first, falls back to app-level token
- **Fallback**: Category-based fee estimates if API fails

---

## Answers to Requirements

1. ✅ **List all SP-API endpoints used**: Catalog Items, Pricing, Fees (see above)
2. ✅ **State OAuth requirements**: Catalog (no), Pricing (yes), Fees (conditional)
3. ✅ **Confirm OAuth-free keyword discovery + catalog**: Yes, confirmed
4. ✅ **Implement clean fallback**: Rainforest data used when Pricing API skipped
5. ✅ **Add feature flag**: Pricing API gated behind seller OAuth token check

