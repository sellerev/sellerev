# Keyword Analyze - Complete Breakdown

## Overview Flow

```
User Input (keyword) 
  ↓
/api/analyze route (POST)
  ↓
fetchKeywordMarketSnapshot(keyword)
  ↓
Rainforest API (Amazon search results)
  ↓
Parse & Aggregate Data
  ↓
Estimate Revenue & Search Volume
  ↓
Calculate CPI (Competitive Pressure Index)
  ↓
Build Margin Snapshot
  ↓
AI Analysis (OpenAI)
  ↓
Save to Database
  ↓
Return Response to Frontend
```

---

## Data Sources

### Primary: Rainforest API
- **Endpoint**: `https://api.rainforestapi.com/request`
- **Type**: `search`
- **Domain**: `amazon.com`
- **Page**: `1` (only Page 1 results)
- **Returns**: Raw Amazon search results JSON

### What Rainforest Provides:
- `search_results[]` - Array of products on Page 1
- `search_information.total_results` - Total search results count (string like "50,000 results")
- Each product has: `asin`, `title`, `price`, `rating`, `reviews`, `is_sponsored`, `position`, `brand`, `image`, etc.

---

## Metric Calculations

### 1. **Reviews** (Raw Data)
**Source**: Direct from Rainforest API  
**Field**: `item.reviews.count` or `item.reviews`  
**Parsing**:
```typescript
function parseReviews(item: any): number | null {
  if (item.reviews?.count !== undefined) {
    return parseInt(item.reviews.count.toString().replace(/,/g, ""), 10);
  }
  if (typeof item.reviews === "number") {
    return item.reviews;
  }
  return null;
}
```

**Average Reviews**:
- Filters listings that have `reviews !== null`
- Sums all review counts
- Divides by count of listings with reviews
- Rounds to nearest integer

**Example**: If 3 products have reviews [1000, 2500, 500], avg = (1000 + 2500 + 500) / 3 = 1333

---

### 2. **Price** (Raw Data)
**Source**: Direct from Rainforest API  
**Field**: `item.price.value` or `item.price.raw` or `item.price`  
**Parsing**:
```typescript
function parsePrice(item: any): number | null {
  // Tries multiple formats: price.value, price.raw, direct number, string
  // Removes currency symbols and commas
  // Returns null if invalid
}
```

**Average Price**:
- Filters listings that have `price !== null`
- Sums all prices
- Divides by count of listings with price
- Rounds to 2 decimal places

**Example**: If 3 products have prices [$25.99, $30.00, $19.50], avg = (25.99 + 30.00 + 19.50) / 3 = $25.16

---

### 3. **Rating** (Raw Data)
**Source**: Direct from Rainforest API  
**Field**: `item.rating`  
**Parsing**:
```typescript
function parseRating(item: any): number | null {
  if (item.rating !== undefined && item.rating !== null) {
    return parseFloat(item.rating.toString());
  }
  return null;
}
```

**Average Rating**:
- Filters listings that have `rating !== null`
- Sums all ratings
- Divides by count of listings with rating
- Rounds to 1 decimal place

**Example**: If 3 products have ratings [4.5, 4.7, 4.2], avg = (4.5 + 4.7 + 4.2) / 3 = 4.5

---

### 4. **BSR (Best Seller Rank)** (Raw Data - If Available)
**Source**: Rainforest API (may not always be present)  
**Fields Tried**: `item.bsr`, `item.best_seller_rank`, `item.rank`  
**Parsing**:
```typescript
function parseBSR(item: any): number | null {
  // Tries multiple field names
  // Removes commas from numbers
  // Returns null if not found
}
```

**Average BSR**:
- Filters listings that have `bsr !== null`
- Sums all BSR values
- Divides by count of listings with BSR
- Rounds to nearest integer

**Note**: BSR may not be available in search results - requires product detail API call

---

### 5. **Organic Rank** (Raw Data)
**Source**: Direct from Rainforest API  
**Field**: `item.position` or array index + 1  
**Calculation**:
```typescript
const position = item.position ?? index + 1; // 1-indexed
```

**Display**: Shows as `#1`, `#2`, `#3`, etc. in the products table

---

### 6. **Fulfillment Type** (Raw Data - If Available)
**Source**: Rainforest API (may not always be present)  
**Fields Tried**: `item.fulfillment`, `item.is_amazon`, `item.is_prime`  
**Parsing**:
```typescript
function parseFulfillment(item: any): "FBA" | "FBM" | "Amazon" | null {
  // Checks for "FBA", "FULFILLED BY AMAZON" → "FBA"
  // Checks for "FBM", "MERCHANT" → "FBM"
  // Checks for "AMAZON" or is_amazon → "Amazon"
  // Checks is_prime → "FBA" (heuristic)
}
```

**Fulfillment Mix**:
- Counts listings by fulfillment type
- Calculates percentages: `(count / total) * 100`
- Rounds to nearest integer

**Example**: If 10 listings: 6 FBA, 3 FBM, 1 Amazon
- FBA: 60%
- FBM: 30%
- Amazon: 10%

---

### 7. **Sponsored Count** (Raw Data)
**Source**: Direct from Rainforest API  
**Field**: `item.is_sponsored` (boolean)  
**Calculation**:
```typescript
const sponsored_count = validListings.filter((l) => l.is_sponsored).length;
```

**Display**: Simple count of sponsored listings on Page 1

---

### 8. **Brand Dominance** (Calculated)
**Source**: Derived from listings  
**Calculation**:
```typescript
// 1. Count occurrences of each brand
const brandCounts: Record<string, number> = {};
validListings.forEach((l) => {
  if (l.brand) {
    brandCounts[l.brand] = (brandCounts[l.brand] || 0) + 1;
  }
});

// 2. Find top brand
const topBrand = Object.entries(brandCounts)
  .sort((a, b) => b[1] - a[1])[0];

// 3. Calculate percentage
const dominance_score = (topBrand[1] / total_page1_listings) * 100;
```

**Example**: If 10 listings and "Sterilite" appears 4 times:
- Dominance = (4 / 10) * 100 = 40%

**Brand Extraction**:
- First tries `item.brand` from API
- Falls back to inferring from title: `title.match(/^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/)`
- Returns first 1-2 capitalized words before separators

---

### 9. **30-Day Revenue Estimates** (Modeled - NOT Real Data)

**⚠️ IMPORTANT**: These are **estimates**, not actual revenue data. Amazon does not provide revenue data.

#### Per-Product Revenue Estimate

**Formula**:
```
est_revenue = BASE_30DAY_REVENUE_POSITION_1 × price_ratio × velocity_multiplier
```

**Components**:

1. **Base Revenue** (`BASE_30DAY_REVENUE_POSITION_1`):
   - **Value**: $150,000 (30-day revenue for position #1)
   - **Rationale**: Conservative estimate based on H10 data showing top products with $500k-$1M+ in 30-day revenue

2. **Price Ratio**:
   ```typescript
   priceRatio = listing_price / avg_price
   // Clamped to 0.5x - 2.0x range
   ```
   - If product is 2x average price → 2.0x multiplier
   - If product is 0.5x average price → 0.5x multiplier
   - Normalizes around 1.0 (average price = 1.0x)

3. **Velocity Multiplier** (Position-Based):
   - Category-specific lookup table
   - Position #1 = 1.0x
   - Position #2 = 0.65x - 0.75x (depending on category)
   - Position #10 = 0.08x - 0.12x
   - **Categories**:
     - `electronics`: Higher velocity (1.0, 0.75, 0.60, ...)
     - `home`: Moderate velocity (1.0, 0.70, 0.55, ...)
     - `beauty`: Higher velocity (1.0, 0.72, 0.58, ...)
     - `health`: Moderate velocity (1.0, 0.68, 0.52, ...)
     - `default`: Conservative (1.0, 0.65, 0.50, ...)

**Category Inference**:
```typescript
function inferCategory(keyword: string): string {
  // Regex patterns match keyword to category
  // "laundry basket" → "home" (matches /home|kitchen|.../)
  // "wireless earbuds" → "electronics" (matches /electronic|tech|.../)
}
```

**Example Calculation**:
- Keyword: "laundry basket" → category: "home"
- Product at position #3, price $30, avg_price $25
- Price ratio: 30 / 25 = 1.2 (clamped to 1.2)
- Velocity multiplier (home, pos 3): 0.55
- Revenue: $150,000 × 1.2 × 0.55 = **$99,000**

**Confidence**:
- Positions 1-8: "medium" confidence
- Positions 9+: "low" confidence

#### Total Page-1 Revenue Aggregation

**Formula**:
```typescript
// For each listing with revenue estimate:
if (confidence === "low") {
  min = revenue × 0.6  // -40%
  max = revenue × 1.4  // +40%
} else {
  min = revenue × 0.75  // -25%
  max = revenue × 1.25  // +25%
}

// Sum all min/max values
total_revenue_min = sum(all_mins)
total_revenue_max = sum(all_maxs)
```

**Example**:
- Product 1: $150k (medium) → $112.5k - $187.5k
- Product 2: $100k (medium) → $75k - $125k
- Product 3: $50k (low) → $30k - $70k
- **Total**: $217.5k - $382.5k

---

### 10. **30-Day Units Sold Estimates** (Modeled - NOT Real Data)

**Formula**:
```typescript
est_units = est_revenue / price
```

**Example**:
- Revenue: $99,000
- Price: $30
- Units: $99,000 / $30 = **3,300 units**

**Aggregation**:
- Same confidence-based ranges as revenue
- Low confidence: ±40%
- Medium confidence: ±25%

---

### 11. **Search Volume** (Modeled - NOT Real Data)

**⚠️ IMPORTANT**: This is an **estimate**, not Amazon-reported search volume. Amazon does not provide this data publicly.

**Formula**:
```
estimated_volume = base_volume × category_multiplier × review_multiplier × sponsored_multiplier
```

**Components**:

1. **Base Volume**:
   ```typescript
   if (totalResults !== null) {
     // From Rainforest search_information.total_results
     baseVolume = totalResults / 50  // Conservative: monthly searches ≈ total_results / 50
     baseVolume = Math.min(baseVolume, 200000)  // Cap at 200k
   } else {
     // Fallback: page1_listings × 1500
     baseVolume = page1Listings * 1500
   }
   
   // Absolute fallback
   if (baseVolume === 0) {
     baseVolume = page1Listings * 500  // Very conservative
   }
   if (baseVolume === 0) {
     baseVolume = 1000  // Minimum
   }
   ```

2. **Category Multiplier**:
   - `electronics`: 1.5x
   - `beauty`: 1.3x
   - `home`: 1.0x (baseline)
   - `health`: 0.9x
   - `default`: 1.0x

3. **Review Multiplier** (Demand Proxy):
   ```typescript
   // Higher reviews = more historical searches
   reviewMultiplier = 1.0 + (log10(avgReviews) - 2) * 0.15
   // Clamped to 0.8x - 1.5x
   ```
   - 100 reviews → ~1.0x
   - 1,000 reviews → ~1.15x
   - 10,000 reviews → ~1.3x

4. **Sponsored Multiplier** (Competition Intensity):
   ```typescript
   sponsoredRatio = sponsoredCount / page1Listings
   sponsoredMultiplier = 0.9 + (sponsoredRatio * 0.6)
   ```
   - 0% sponsored → 0.9x
   - 50% sponsored → 1.2x
   - 100% sponsored → 1.5x

**Range Calculation**:
```typescript
// ±30% around estimate (or ±50% if page1_listings < 20)
minVolume = estimatedVolume × 0.7
maxVolume = estimatedVolume × 1.3
```

**Formatting**:
- < 1,000: "500–800"
- 1,000+: "10k–20k"
- 1,000,000+: "1.5M–2M"

**Example Calculation**:
- Keyword: "laundry basket"
- totalResults: 50,000 → baseVolume = 50,000 / 50 = 1,000
- Category (home): 1.0x
- Avg reviews: 2,000 → reviewMultiplier = 1.15x
- Sponsored: 5/50 = 10% → sponsoredMultiplier = 0.96x
- Estimated: 1,000 × 1.0 × 1.15 × 0.96 = **1,104**
- Range: 773 - 1,435 → **"773–1,435"** (or "1k–1k" if rounded)

**Confidence**:
- "medium" if: totalResults exists OR page1_listings >= 20 AND avg_reviews exists
- "low" otherwise

---

### 12. **Competitive Pressure Index (CPI)** (Calculated)

**Source**: Calculated from aggregated data + seller context  
**File**: `lib/amazon/competitivePressureIndex.ts` (not shown, but referenced)

**Components**:
- **Review Dominance** (0-30 points): Based on average review count
- **Brand Concentration** (0-25 points): Based on dominance_score
- **Sponsored Saturation** (0-20 points): Based on sponsored_count / total_listings
- **Price Compression** (0-15 points): Based on price variance
- **Seller Fit Modifier** (-10 to +10 points): Adjusts based on seller stage/experience

**Total Score**: 0-100
- 0-30: "Low — structurally penetrable"
- 31-50: "Moderate — requires differentiation"
- 51-75: "High — strong incumbents"
- 76-100: "Extreme — brand-locked"

---

## Data Flow Summary

### Step 1: Fetch Raw Data
```
Rainforest API → search_results[] array
```

### Step 2: Parse Each Listing
```
For each item in search_results:
  - Extract: asin, title, price, rating, reviews, is_sponsored, position, brand, image
  - Try to extract: bsr, fulfillment
  - Validate: Must have asin AND title
```

### Step 3: Calculate Aggregates
```
- avg_price = sum(prices) / count(prices)
- avg_reviews = sum(reviews) / count(reviews)
- avg_rating = sum(ratings) / count(ratings)
- avg_bsr = sum(bsrs) / count(bsrs)
- sponsored_count = count(is_sponsored === true)
- dominance_score = (top_brand_count / total) × 100
- fulfillment_mix = percentages of FBA/FBM/Amazon
```

### Step 4: Estimate Revenue (Per Product)
```
For each listing:
  - Infer category from keyword
  - Get velocity multiplier for position
  - Calculate price ratio
  - est_revenue = $150k × price_ratio × velocity_multiplier
  - est_units = est_revenue / price
```

### Step 5: Aggregate Revenue Estimates
```
- Sum all revenue estimates with confidence-based ranges
- total_revenue_min = sum(all_mins)
- total_revenue_max = sum(all_maxs)
- Same for units
```

### Step 6: Estimate Search Volume
```
- Get base volume from total_results or page1_listings
- Apply category, review, and sponsored multipliers
- Calculate range (±30% or ±50%)
- Format as "10k–20k"
```

### Step 7: Calculate CPI
```
- Compute from review dominance, brand concentration, etc.
- Add seller context modifier
- Return score 0-100 with label
```

### Step 8: Build Margin Snapshot
```
- Use avg_price or representative ASIN price
- Estimate COGS from sourcing model
- Fetch FBA fees (SP-API if available, else estimate)
- Calculate net margin range
- Calculate breakeven price range
```

### Step 9: AI Analysis
```
- Pass all data to OpenAI
- AI generates: verdict, confidence, summary, risks, actions
- AI uses ONLY the provided data (no hallucinations)
```

### Step 10: Save & Return
```
- Save to analysis_runs table
- Return structured response to frontend
- Frontend displays data-first, then AI interpretation
```

---

## Key Limitations

1. **Revenue/Units**: Modeled estimates, not real data
2. **Search Volume**: Modeled estimates, not Amazon-reported
3. **BSR**: May not be available in search results (needs product detail API)
4. **Fulfillment**: May not be available in search results
5. **Seller Country/Size Tier**: Not available in search results (needs product detail API)
6. **Page 1 Only**: Only analyzes first page of results

---

## Accuracy Notes

- **Raw Data** (price, rating, reviews, position): ✅ Accurate (from Amazon via Rainforest)
- **Aggregates** (averages, counts): ✅ Accurate (simple math on raw data)
- **Revenue Estimates**: ⚠️ Modeled (conservative estimates, not real)
- **Search Volume**: ⚠️ Modeled (heuristic-based, not real)
- **CPI**: ✅ Deterministic calculation (reproducible, but subjective scoring)

---

## Future Improvements

1. **SQP Integration**: Replace search volume estimator with Amazon SP-API Search Query Performance data (exact Amazon data)
2. **Product Detail API**: Fetch BSR, fulfillment, size tier for top products
3. **Revenue Calibration**: Adjust base revenue based on historical accuracy
4. **Multi-Page Analysis**: Analyze pages 2-3 for more complete market view
