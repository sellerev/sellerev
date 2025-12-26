# Helium 10 Calibration Plan

This document outlines the plan to calibrate Sellerev's market analysis metrics to match Helium 10's accuracy.

## Test Keywords & Benchmarks

| Keyword | Products | Avg Price | Avg BSR | Monthly Units | Monthly Revenue | Avg Rating | Search Volume |
|---------|----------|-----------|---------|---------------|-----------------|------------|---------------|
| Vacuum Storage Bags | 49 | $21.32 | 98,600 | 682,985 | $15,448,035 | 4.50 | 45,515 |
| Resistance Bands | 50 | $24.21 | 24,586 | 428,799 | $6,932,595 | 4.50 | 122,514 |
| Face Serum | 48 | $22.77 | 6,298 | 1,955,995 | $40,673,615 | 4.50 | 10,216 |
| Dog Poop Bags | 49 | $19.13 | 9,742 | 1,328,219 | $16,818,429 | 4.70 | 27,379 |
| Toy Storage Bin | 49 | $38.12 | 15,519 | 373,305 | $14,571,461 | 4.50 | 973 |
| Kitchen Scale | 49 | $25.25 | 46,186 | 738,175 | $13,028,843 | 4.60 | 61,396 |

## Current Implementation Analysis

### 1. Number of Products
**Current:** `snapshot.total_page1_listings` (count of Page 1 listings from Rainforest API)
**H10 Target:** ~49-50 products per keyword
**Status:** Should be close if Rainforest returns full Page 1 (typically 16-20 organic + sponsored)

**Action Needed:**
- Verify Rainforest API returns all Page 1 listings (not just first 16)
- May need to fetch multiple pages or use different API endpoint
- H10 likely includes more than just Page 1 (possibly top 50-100 results)

### 2. Average Price
**Current:** `snapshot.avg_price` (average of all listings with price data)
**H10 Target:** See table above
**Status:** Should be accurate if price extraction is correct

**Action Needed:**
- Verify price parsing from Rainforest API
- Ensure we're including all listings (not filtering out sponsored)
- Check if H10 uses median vs mean (likely mean based on "Average")

### 3. Average BSR
**Current:** `snapshot.avg_bsr` (average of all listings with BSR data)
**H10 Target:** See table above
**Status:** Depends on BSR extraction from Rainforest

**Action Needed:**
- Verify BSR extraction from Rainforest API
- May need to fetch BSR from product detail pages if not in search results
- H10 likely uses main category BSR (which we already do)

### 4. Monthly Units
**Current:** 
- Primary: `snapshot.est_total_monthly_units_min` (from V2 model or V1 aggregation)
- Fallback: Sum of `listing.est_monthly_units` (from position-based revenue estimator)

**H10 Target:** See table above (ranges from 373K to 1.9M)

**Current Calculation Method:**
- V1: Uses `estimateListingRevenueWithUnits()` which:
  - Estimates revenue from position/price
  - Converts to units: `units = revenue / price`
- V2: Uses trained model with calibration

**Action Needed:**
- **CRITICAL:** Our revenue estimator uses position-based heuristics, not BSR-based
- H10 likely uses BSR-to-sales conversion (which we have in `bsr-calculator.ts`)
- Need to switch from position-based to BSR-based revenue estimation
- Use `estimateMonthlySalesFromBSR()` for each listing, then sum

### 5. Monthly Revenue
**Current:**
- Primary: `snapshot.est_total_monthly_revenue_min` (from V2 model or V1 aggregation)
- Fallback: Sum of `listing.est_monthly_revenue` (from position-based revenue estimator)

**H10 Target:** See table above (ranges from $6.9M to $40.6M)

**Current Calculation Method:**
- V1: `BASE_30DAY_REVENUE_POSITION_1 ($150k) * price_ratio * velocity_multiplier`
- V2: Trained model with calibration

**Action Needed:**
- **CRITICAL:** Switch to BSR-based calculation
- Formula: `monthly_revenue = sum(monthly_units * price)` where `monthly_units = estimateMonthlySalesFromBSR(bsr, category)`
- This will be much more accurate than position-based estimates

### 6. Average Rating
**Current:** `snapshot.avg_rating` (average of all listings with rating data)
**H10 Target:** See table above (4.50-4.70)
**Status:** Should be accurate if rating extraction is correct

**Action Needed:**
- Verify rating extraction from Rainforest API
- Ensure we're including all listings

### 7. Search Volume
**Current:**
- Primary: `snapshot.search_demand.search_volume_range` (from V2 model or V1 heuristic)
- V1: `base = page1Listings.length * 1800` with multipliers
- V2: Calibrated model

**H10 Target:** See table above (ranges from 973 to 122,514)

**Current Calculation Method:**
- V1: Deterministic heuristic based on page1 count, reviews, sponsored %
- V2: Linear calibration model

**Action Needed:**
- Review V1 base formula: `page1Listings.length * 1800` seems too low
- For 49 products, base = 49 * 1800 = 88,200 (but H10 shows 45,515 for Vacuum Storage Bags)
- Need to calibrate multipliers and base formula
- May need to incorporate actual search volume data if available

## Priority Actions

### High Priority (Critical for Accuracy)

1. **Switch Revenue/Units Estimation to BSR-Based**
   - File: `lib/amazon/revenueEstimator.ts`
   - Change: Use `estimateMonthlySalesFromBSR()` instead of position-based heuristics
   - Impact: Will dramatically improve Monthly Units and Monthly Revenue accuracy

2. **Verify Product Count**
   - File: `lib/amazon/keywordMarket.ts`
   - Check: Does Rainforest API return all Page 1 listings?
   - May need: Fetch additional pages or use different endpoint

3. **Calibrate Search Volume Model**
   - File: `lib/amazon/searchVolumeEstimator.ts`
   - Adjust: Base formula and multipliers to match H10 data
   - May need: Category-specific adjustments

### Medium Priority

4. **Verify BSR Extraction**
   - Ensure we're getting main category BSR from all listings
   - May need to fetch from product detail pages

5. **Verify Price/Rating Extraction**
   - Ensure all listings have price and rating data
   - Check for parsing errors

### Low Priority

6. **Fine-tune Aggregation Methods**
   - Consider using median vs mean for certain metrics
   - Add outlier filtering if needed

## Testing Plan

1. **Run Comparison API**
   ```bash
   GET /api/test-h10-comparison
   ```
   This will analyze all 6 keywords and return comparison data.

2. **Review Results**
   - Check which metrics are "far" (>20% difference)
   - Identify patterns (e.g., all revenue estimates too low)

3. **Make Adjustments**
   - Start with BSR-based revenue estimation (highest impact)
   - Then calibrate search volume
   - Finally fine-tune other metrics

4. **Re-test**
   - Run comparison again
   - Target: <10% difference for all metrics

## Implementation Notes

### BSR-Based Revenue Estimation

Current approach (position-based):
```typescript
// lib/amazon/revenueEstimator.ts
estimateListingRevenue(price, position, avgPrice, keyword)
// Uses: BASE_30DAY_REVENUE_POSITION_1 * price_ratio * velocity_multiplier
```

Proposed approach (BSR-based):
```typescript
// lib/amazon/keywordMarket.ts (in fetchKeywordMarketSnapshot)
for (const listing of listings) {
  if (listing.bsr && listing.price) {
    const category = inferCategoryFromListing(listing);
    const monthlyUnits = estimateMonthlySalesFromBSR(listing.bsr, category);
    listing.est_monthly_units = monthlyUnits;
    listing.est_monthly_revenue = monthlyUnits * listing.price;
  }
}
```

This will require:
- Category detection for each listing (may need to fetch product details)
- Fallback to position-based if BSR missing
- Update aggregation logic

### Search Volume Calibration

Current V1 formula:
```typescript
base = page1Listings.length * 1800
// With multipliers for reviews, sponsored %, category
```

Observations from H10 data:
- Vacuum Storage Bags: 49 products → 45,515 volume (ratio: 928 per product)
- Resistance Bands: 50 products → 122,514 volume (ratio: 2,450 per product)
- Face Serum: 48 products → 10,216 volume (ratio: 213 per product)

The ratio varies significantly, suggesting:
- Category matters a lot
- Review count matters
- Need better base formula

Proposed approach:
- Use category-specific base multipliers
- Incorporate review density
- Calibrate with H10 data

