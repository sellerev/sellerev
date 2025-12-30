# Analyze Feature - End-to-End Architecture Breakdown

## Overview
The Analyze feature is the core product analysis system that evaluates Amazon product opportunities based on keyword searches. It combines real market data (Rainforest API), AI decision-making (OpenAI), and structured data contracts to provide actionable insights.

---

## 🎯 High-Level Flow

```
User Input (Keyword)
    ↓
Frontend (AnalyzeForm.tsx)
    ↓
API Route (/api/analyze)
    ↓
Data Fetching (Market-First Architecture)
    ├─→ Real Market Data (Rainforest API) [PRIORITY]
    └─→ Snapshot Fallback (Database Cache)
    ↓
Canonical Page-1 Builder
    ↓
Data Contract Builder
    ↓
AI Decision (OpenAI GPT-4o-mini)
    ↓
Response Assembly
    ↓
Database Persistence
    ↓
Frontend Rendering
```

---

## 📦 Component Breakdown

### 1. **Frontend Component: `AnalyzeForm.tsx`**

**Location:** `app/analyze/AnalyzeForm.tsx`

**Responsibilities:**
- User input collection (keyword search)
- API request orchestration
- Results display (market snapshot, Page-1 grid, AI verdict)
- Chat integration (persistent sidebar)
- State management (loading, error, analysis data)

**Key Features:**
- Two-column layout: 70% analysis blocks, 30% chat sidebar
- Pre-analysis state: Input form only
- Post-analysis state: All blocks + chat visible
- Data routing: Always uses canonical Page-1 listings when available
  - Priority 1: `analysis.page_one_listings` (canonical)
  - Priority 2: `analysis.products` (same as page_one_listings)
  - Priority 3: `analysis.market_snapshot.listings` (backward compatibility)

**State Variables:**
- `inputValue`: User-entered keyword
- `loading`: Request in progress
- `error`: Error message
- `analysis`: Full analysis response
- `chatMessages`: Chat history
- `selectedListing`: Currently selected product for chat context
- `sortBy`: Page-1 grid sort order (revenue/units/bsr/reviews/price)

**UI Sections:**
1. **Input Form**: Keyword search input with validation
2. **Market Snapshot**: Aggregated metrics (avg price, reviews, monthly units/revenue, etc.)
3. **PPC Indicators**: Ad intensity assessment
4. **Page 1 Results**: Product grid (Amazon-style cards)
   - **Card Display:**
     - Rank #X (Page-1 position, not BSR)
     - FBA / FBM badge
     - Estimated Monthly Revenue
     - Estimated Monthly Units
     - Price, Rating, Reviews
     - **Note:** BSR is NOT displayed on keyword Page-1 cards (only in ASIN analysis)
5. **AI Verdict**: GO/CAUTION/NO_GO decision with reasoning
6. **Chat Sidebar**: Contextual Q&A about the analysis

---

### 2. **API Route: `/api/analyze/route.ts`**

**Location:** `app/api/analyze/route.ts`

**Method:** `POST`

**Request Body:**
```typescript
{
  input_type: "keyword",
  input_value: string
}
```

**Response:**
```typescript
{
  success: boolean,
  analysis_run_id: string,
  decision: { verdict, confidence },
  executive_summary: string,
  reasoning: { primary_factors, seller_context_impact },
  risks: { competition, pricing, differentiation, operations },
  recommended_actions: { must_do, should_do, avoid },
  market_snapshot: {...},
  page_one_listings: [...],
  margin_snapshot: {...},
  dataSource: "market" | "snapshot",
  data_quality: {...}
}
```

**Processing Steps:**

#### Step 1: Authentication & Authorization
- Verifies user authentication (Supabase)
- Checks seller profile exists (onboarding completion)
- Loads latest seller profile with all fields

#### Step 2: Usage Limits
- Checks `usage_counters` table
- Limits: 20 analyses per 30-day period
- Admin/dev email bypass available

#### Step 3: Market Data Fetching (Market-First Architecture)

**Priority Order:**
1. **Real Market Data (Rainforest API)** - `fetchKeywordMarketSnapshot()`
   - Fetches live Amazon search results
   - Parses listings: ASIN, title, price, rating, reviews, BSR, image
   - Computes market aggregates
   - Sets `dataSource = "market"` if real ASINs found
   - **CRITICAL**: If real listings exist, snapshot lookup is SKIPPED

2. **Snapshot Fallback** (only if no real market data)
   - Tier-2 Snapshot (precomputed, from database)
   - Tier-1 Estimate (instant heuristic, $0 cost)
   - Sets `dataSource = "snapshot"` or `"estimated"`

**Key Files:**
- `lib/amazon/keywordMarket.ts`: Rainforest API integration
- `lib/snapshots/keywordSnapshots.ts`: Snapshot lookup
- `lib/snapshots/tier1Estimate.ts`: Tier-1 instant estimates

#### Step 4: Canonical Page-1 Builder (Type-Specific Routing)

**Location:** `lib/amazon/canonicalPageOne.ts`

**Purpose:** Transforms raw listings into standardized Page-1 product set

**Architecture:** Two separate builders based on input type

**1. Keyword Analysis: `buildKeywordPageOne()` (PERMISSIVE)**
- **Input:** `ParsedListing[]` from keyword search
- **Output:** `CanonicalProduct[]`
- **Rules:**
  - DO NOT reject synthetic ASINs (allows `KEYWORD-X` patterns)
  - DO NOT require historical data
  - DO NOT filter sponsored listings
  - DO NOT return empty if listings exist
  - Always returns Page-1 rows when listings exist
- **Estimation Logic:**
  - **Units Estimation:**
    - If `est_monthly_units` exists → use it
    - If BSR exists and > 0 → `units = round(600000 / pow(bsr, 0.45))`, clamped to min 50, max 50,000
    - If BSR is missing → rank-based fallback: `units = round(3000 / rank)`, clamped to min 50, max 50,000
    - **Result:** All products get non-zero units (never 0)
  - **Revenue Estimation:**
    - If `est_monthly_revenue` exists → use it
    - Otherwise → `revenue = round(estimatedUnits × price)`
  - Calculates revenue share percentages from total revenue
  - Maps fulfillment types (`"Amazon"` → `"AMZ"`)
  - Never hard-fails due to imperfect data

**2. ASIN Analysis: `buildAsinPageOne()` (STRICT)**
- **Input:** `ParsedListing[]`, `KeywordMarketSnapshot`, keyword, marketplace, supabase
- **Output:** `CanonicalProduct[]`
- **Rules:**
  - Requires valid ASINs (rejects synthetic)
  - Requires historical data validation (if available)
  - Filters invalid listings
  - Strict validation and calibration
- **Operations:**
  - Filters organic listings (excludes sponsored)
  - Validates ASINs (rejects synthetic ESTIMATED-X/INFERRED-X)
  - Sorts by revenue (descending)
  - Re-ranks products
  - Calculates revenue share percentages
  - Applies BSR duplicate detection
  - Applies Page-1 demand calibration
  - Blends with ASIN-level historical data

**Key Fields:**
- `rank`, `asin`, `title`, `image_url`, `price`, `rating`, `review_count`
- `bsr`, `estimated_monthly_units`, `estimated_monthly_revenue`
- `revenue_share_pct`, `fulfillment`, `brand`, `seller_country`

**Routing Logic:**
```typescript
if (input_type === "keyword") {
  pageOneProducts = buildKeywordPageOne(rawListings);
} else {
  pageOneProducts = await buildAsinPageOne(rawListings, snapshot, ...);
}
```

**Critical Rules:**
- Keyword analysis: Permissive, never hard-fails, allows synthetic ASINs
- ASIN analysis: Strict, validates ASINs, applies calibration and historical blending

#### Step 5: Data Contract Builder

**Location:** `lib/analyze/dataContract.ts`

**Function:** `buildKeywordAnalyzeResponse()`

**Purpose:** Builds structured data contract for AI consumption

**Structure:**
```typescript
{
  keyword: string,
  summary: { avg_price, avg_rating, total_monthly_units_est, ... },
  products: [...], // Canonical Page-1 products
  page_one_listings: [...], // Same as products (explicit for UI)
  aggregates_derived_from_page_one: {...},
  market_structure: {
    price_band: { min, max },
    review_barrier: { median_reviews, top_5_avg_reviews },
    brand_dominance_pct: number
  },
  margin_snapshot: {...},
  signals: {...},
  ai_context: {...} // Structured context for AI
}
```

**Key Features:**
- **Canonical Products Input:** If `canonicalProducts` provided, uses them directly (no rebuilding)
- **Market Snapshot Aggregation:** 
  - Sums `estimated_monthly_units` from canonical products (filters > 0)
  - Sums `estimated_monthly_revenue` from canonical products (filters > 0)
  - Calculates average BSR from canonical products (filters null/0)
  - Assigns totals to `snapshot.monthly_units`, `snapshot.monthly_revenue`, `snapshot.avg_bsr`
- Aggregates computed from canonical Page-1 products (not snapshot)
- Ensures UI, aggregates, and cards all derive from ONE canonical array
- Keyword-level historical blending (if Supabase available)

#### Step 6: Margin Snapshot Calculation

**Location:** `lib/margins/buildMarginSnapshot.ts`

**Purpose:** Calculates profit margins for the product opportunity

**Inputs:**
- Average price (from market snapshot)
- FBA fees (from SP-API or estimated)
- Seller sourcing model (private label, wholesale, etc.)

**Output:** Margin breakdown with cost structure

#### Step 7: AI Decision Generation

**Model:** OpenAI GPT-4o-mini

**System Prompt:** Extensive prompt with:
- Core operating principles (conservatism, seller-specific reasoning)
- Numeric grounding rules (must cite 2+ metrics)
- Verdict guidelines (GO/CAUTION/NO_GO)
- Confidence score justification
- Executive summary structure
- Risk breakdown requirements

**User Message:**
```
SELLER CONTEXT:
- Stage: new/existing/thinking
- Experience (months): number
- Monthly revenue range: string

ANALYSIS REQUEST:
{keyword}
```

**AI Output Contract:**
```typescript
{
  decision: { verdict: "GO" | "CAUTION" | "NO_GO", confidence: number },
  executive_summary: string,
  reasoning: { primary_factors: string[], seller_context_impact: string },
  risks: {
    competition: { level: "Low" | "Medium" | "High", explanation: string },
    pricing: {...},
    differentiation: {...},
    operations: {...}
  },
  recommended_actions: { must_do: string[], should_do: string[], avoid: string[] },
  assumptions_and_limits: string[],
  numbers_used: {
    avg_price: number | null,
    price_range: [number, number] | null,
    median_reviews: number | null,
    ...
  }
}
```

**Post-Processing:**
- Validates decision contract structure
- Normalizes risks (ensures all 4 keys present)
- Applies keyword-specific confidence caps:
  - Max 75% for keyword searches
  - Downgrades for sparse data (< 5 listings → max 40%, < 10 → max 60%)
- Maps contract response to `numbers_used` format

#### Step 8: CPI Calculation

**Location:** `lib/amazon/competitivePressureIndex.ts`

**Function:** `calculateCPI()`

**Purpose:** Computes 0-100 competitive pressure score

**Factors:**
- Review dominance (0-30 points)
- Brand concentration (0-25 points)
- Sponsored saturation (0-20 points)
- Price compression (0-15 points)
- Seller fit modifier (-10 to +10 points)

**Labels:**
- "Low — structurally penetrable" (0-30)
- "Moderate — requires differentiation" (31-50)
- "High — strong incumbents" (51-70)
- "Extreme — brand-locked" (71-100)

#### Step 9: Response Assembly

**Critical: Canonical Products Assignment**
- Canonical products are **unconditionally assigned** to final response:
  - `finalResponse.page_one_listings = canonicalProducts`
  - `finalResponse.products = canonicalProducts`
- No conditionals, no fallbacks - canonical products always win
- Response structure nests under `decision` key for frontend

**Final Response Structure:**
```typescript
{
  success: true,
  analysis_run_id: string,
  created_at: string,
  input_type: "keyword",
  input_value: string,
  decision: {...},
  executive_summary: string,
  reasoning: {...},
  risks: {...},
  recommended_actions: {...},
  assumptions_and_limits: string[],
  market_snapshot: {
    keyword: string,
    avg_price: number,
    avg_reviews: number,
    avg_rating: number,
    avg_bsr: number,
    total_page1_listings: number,
    sponsored_count: number,
    dominance_score: number,
    fulfillment_mix: {...},
    cpi: {...},
    ppc: {...},
    est_total_monthly_revenue_min: number,
    est_total_monthly_revenue_max: number,
    est_total_monthly_units_min: number,
    est_total_monthly_units_max: number,
    listings: [...]
  },
  page_one_listings: [...], // Canonical Page-1 products
  products: [...], // Same as page_one_listings
  aggregates_derived_from_page_one: {...},
  margin_snapshot: {...},
  dataSource: "market" | "snapshot",
  data_quality: {
    snapshot: "hit" | "miss" | "market",
    source: "market" | "precomputed" | "estimated",
    fallback_used: boolean,
    estimated: boolean
  }
}
```

#### Step 10: Database Persistence

**Table:** `analysis_runs`

**Stored Data:**
- Full analysis response (JSON)
- User ID
- Timestamp
- Input keyword
- Analysis metadata

**Purpose:**
- Chat context (chat reads from this table, never re-fetches)
- History/analytics
- Anti-hallucination (chat cannot fetch new data)

---

## 🔄 Data Flow Architecture

### Market-First Architecture

```
┌─────────────────────────────────────────────────────────┐
│ 1. Try Real Market Data (Rainforest API)               │
│    └─→ fetchKeywordMarketSnapshot()                     │
│         ├─→ If real ASINs found → dataSource = "market"│
│         └─→ SKIP snapshot lookup                        │
└─────────────────────────────────────────────────────────┘
                    ↓ (if no real data)
┌─────────────────────────────────────────────────────────┐
│ 2. Snapshot Fallback                                     │
│    ├─→ Tier-2 Snapshot (database)                        │
│    └─→ Tier-1 Estimate (instant heuristic)               │
│         └─→ dataSource = "snapshot" | "estimated"        │
└─────────────────────────────────────────────────────────┘
```

### Canonical Page-1 Pipeline

```
Raw Listings (ParsedListing[])
    ↓
Route by input_type
    ├─→ input_type === "keyword"
    │    └─→ buildKeywordPageOne()
    │         ├─→ Estimate units: BSR-based OR rank-based fallback
    │         ├─→ Estimate revenue (units × price)
    │         ├─→ Calculate revenue share %
    │         └─→ Allow synthetic ASINs (KEYWORD-X)
    │
    └─→ input_type === "asin" (or other)
         └─→ buildAsinPageOne()
              ├─→ Filter organic (exclude sponsored)
              ├─→ Validate ASINs (reject synthetic)
              ├─→ Sort by revenue (descending)
              ├─→ Re-rank
              ├─→ Calculate revenue share %
              ├─→ BSR duplicate detection
              ├─→ Page-1 demand calibration
              └─→ ASIN-level historical blending
    ↓
Canonical Products (CanonicalProduct[])
    ↓
Data Contract Builder
    ├─→ Use canonical products directly (no rebuilding)
    ├─→ Aggregate market snapshot totals from canonical products
    │    ├─→ Sum estimated_monthly_units (filter > 0)
    │    ├─→ Sum estimated_monthly_revenue (filter > 0)
    │    └─→ Calculate average BSR (filter null/0)
    ├─→ Compute aggregates from canonical products
    ├─→ Build market structure
    └─→ Generate ai_context
    ↓
AI Decision
    ↓
Response Assembly
```

### UI Data Routing

```
API Response
    ↓
Priority Order:
    1. analysis.page_one_listings (canonical Page-1 products)
    2. analysis.products (same as page_one_listings)
    3. analysis.market_snapshot.listings (backward compatibility)

Note: UI must NOT second-guess data - always uses canonical listings when available
```

---

## 🗄️ Database Schema

### `analysis_runs`
- `id`: UUID (primary key)
- `user_id`: UUID (foreign key to auth.users)
- `input_type`: "keyword" | "asin"
- `input_value`: string
- `analysis_response`: JSONB (full response)
- `created_at`: timestamp

### `keyword_snapshots`
- `keyword`: string
- `marketplace`: string
- `average_price`: number
- `average_bsr`: number
- `product_count`: number
- `est_total_monthly_units_min`: number
- `est_total_monthly_units_max`: number
- `est_total_monthly_revenue_min`: number
- `est_total_monthly_revenue_max`: number
- `last_updated`: timestamp

### `usage_counters`
- `user_id`: UUID
- `analyze_count`: number
- `reset_at`: timestamp

### `asin_history`
- `asin`: string
- `estimated_monthly_units`: number
- `recorded_at`: timestamp

---

## 🔐 Key Invariants & Guards

### Canonical Page-1 Routing
- **Routing Rule**: Route canonical logic by `input_type`:
  - `input_type === "keyword"` → `buildKeywordPageOne()` (permissive)
  - Otherwise → `buildAsinPageOne()` (strict)

### Keyword Analysis (Permissive)
- **Invariant**: Keyword analysis must NEVER hard-fail due to imperfect data
- **Rule**: Always returns Page-1 rows if listings exist (never empty)
- **Rule**: Allows synthetic ASINs (`KEYWORD-X` patterns)
- **Rule**: Estimates units/revenue from BSR when missing
- **Log Only**: If `rawListings.length > 0` but `pageOneProducts.length === 0` → log error (don't throw)

### ASIN Analysis (Strict)
- **Invariant**: ASIN canonical products must have valid ASINs (not ESTIMATED-X/INFERRED-X)
- **Guard**: Synthetic ASINs rejected (filters out)
- **Guard**: Only processes listings with proper validation
- **Guard**: Applies calibration and historical blending

### UI Rendering
- **Rule**: UI must NOT second-guess data - always uses canonical `page_one_listings` when available
- **Priority**: `page_one_listings` → `products` → `market_snapshot.listings`
- **Rule**: Never falls back to snapshot listings when canonical listings exist
- **Rule**: Extract canonical fields from API response: `page_one_listings`, `products`, `aggregates_derived_from_page_one` must be copied from `data.decision` to `analysisData`
- **Page-1 Cards**: Display Rank (positional), FBA/FBM, Revenue, Units - BSR not shown for keyword analysis

---

## 🧪 Debugging & Logging

### Forensic Trace Logs
- `🔍 STEP_1_RAW_RAINFOREST_DATA`: Raw Rainforest response
- `🔍 STEP_2_CANONICAL_PAGE1_INPUT`: Input to canonical builder
- `🔍 STEP_3_CANONICAL_PAGE1_OUTPUT`: Output from canonical builder
- `🔍 STEP_4_API_RESPONSE`: Final API response shape
- `🔍 STEP_5_UI_COMPONENT_RECEIVED`: UI component received data

### Keyword Canonical Logs
- `✅ KEYWORD CANONICAL BUILD START`: Start of keyword canonical build
- `✅ KEYWORD PAGE-1 COUNT`: Count of keyword canonical products
- `📦 SAMPLE CANONICAL PRODUCT`: Sample product from keyword canonical output
- `📊 KEYWORD ESTIMATE SAMPLE`: Sample estimate (asin, rank, bsr, units, revenue) for first product
- `📊 ESTIMATION APPLIED`: Estimation statistics (total products, products with estimates, sample values)
- `❌ KEYWORD CANONICAL EMPTY (NON-FATAL)`: Warning when keyword build returns empty (non-fatal)

### Market Snapshot Logs
- `📈 MARKET SNAPSHOT AGGREGATED`: Market snapshot totals aggregated from canonical products (total_monthly_units, total_monthly_revenue, average_bsr)

### API Response Logs
- `✅ FINAL RESPONSE CANONICAL COUNT`: Count of canonical products in final API response

### Debug Logs
- `🧪 RAW INPUT LISTINGS`: First 3 listings
- `🧪 CANONICAL INPUT COUNT`: Input count
- `🧪 CANONICAL OUTPUT COUNT`: Output count
- `🧪 CANONICAL FORCED OUTPUT COUNT`: Forced pass-through count (ASIN mode)

### Error Logs
- `🔴 FATAL`: Critical routing errors (ASIN mode only)
- `🔴 CANONICAL_PAGE1_ERROR`: Canonical builder errors

---

## 📊 Key Metrics & Calculations

### Revenue Estimation (Keyword Analysis)
- **Units Estimation (Priority Order):**
  1. Use existing `est_monthly_units` if present
  2. If BSR exists: `units = round(600000 / pow(bsr, 0.45))`, clamped to min 50, max 50,000
  3. If BSR missing: rank-based fallback `units = round(3000 / rank)`, clamped to min 50, max 50,000
- **Revenue Estimation:**
  - Use existing `est_monthly_revenue` if present
  - Otherwise: `revenue = round(estimatedUnits × price)`
- **Result:** All keyword products have non-zero units/revenue estimates

### Market Aggregates
- **Computed From:** Canonical Page-1 products (single source of truth)
- **Average Price**: Mean of all Page-1 prices
- **Average Rating**: Mean of all Page-1 ratings
- **Average BSR**: Mean of all Page-1 BSRs (for ASIN analysis; not displayed in keyword UI)
- **Total Monthly Units**: Sum of `estimated_monthly_units` where units > 0
- **Total Monthly Revenue**: Sum of `estimated_monthly_revenue` where revenue > 0
- **Market Snapshot Aggregation:** Totals are assigned directly to `snapshot.monthly_units` and `snapshot.monthly_revenue`

### Competitive Metrics
- **Brand Dominance**: % of listings belonging to top brand
- **Sponsored Density**: % of listings that are sponsored
- **Review Barrier**: Median reviews across Page-1
- **Price Compression**: Standard deviation of prices

---

## 🚀 Performance Considerations

### Caching Strategy
- **Tier-2 Snapshots**: Precomputed, stored in database
- **Tier-1 Estimates**: Instant heuristic, $0 cost
- **Market Data**: Live API calls (Rainforest), cached in memory

### Cost Optimization
- **Market-First**: Real data prioritized, snapshots only as fallback
- **Snapshot Lookup**: Database read (fast, free)
- **Tier-1 Generation**: Deterministic heuristic (no API calls)

### Response Time
- **Real Market Data**: ~2-5 seconds (Rainforest API)
- **Snapshot Hit**: ~100-200ms (database read)
- **Tier-1 Estimate**: ~50-100ms (in-memory calculation)
- **AI Decision**: ~2-4 seconds (OpenAI API)

---

## 🔄 Future Enhancements

### Planned Improvements
1. **ASIN Analysis**: Enhanced ASIN analysis with strict canonical validation
2. **Historical Blending**: Enhanced keyword-level history blending
3. **Search Volume**: Integration with SP-API search volume data
4. **Calibration Refinement**: Improved BSR-to-sales model
5. **ASIN Filtering**: Enhanced ASIN canonical filters (currently in pass-through mode)

---

## 📝 Notes

### Current State
- **Canonical Page-1**: Split into keyword (permissive) and ASIN (strict) builders
- **Keyword Analysis**: 
  - Fully permissive - always returns Page-1 products when listings exist
  - Units/revenue estimation: BSR-based with rank fallback (guarantees non-zero values)
  - Market snapshot totals aggregated from canonical products
- **ASIN Analysis**: Currently in pass-through mode (strict logic placeholders ready)
- **Market-First Architecture**: Fully implemented
- **UI Routing**: 
  - Always uses canonical `page_one_listings` when available
  - Extracts `page_one_listings`, `products`, and `aggregates_derived_from_page_one` from API response
- **Page-1 Card Display:**
  - Shows Rank (Page-1 position), FBA/FBM, Revenue, Units
  - BSR removed from keyword Page-1 cards (only in ASIN analysis)
  - Helper note explains category rank available in ASIN analysis

### Known Issues
- ASIN canonical filtering disabled (pass-through mode for backward compatibility)
- Keyword analysis allows synthetic ASINs (`KEYWORD-X`) - this is intentional and permissive
- Historical blending may be incomplete for new keywords

---

## 🎯 Summary

The Analyze feature is a sophisticated product analysis system that:
1. **Fetches** real market data (Rainforest API) or falls back to snapshots
2. **Transforms** raw listings into canonical Page-1 products using type-specific builders:
   - Keyword analysis: Permissive builder with BSR-based or rank-based unit estimation (guarantees non-zero estimates)
   - ASIN analysis: Strict builder with validation and calibration
3. **Aggregates** market snapshot totals from canonical products (units, revenue, BSR)
4. **Builds** structured data contracts for AI consumption (canonical products passed directly)
5. **Assigns** canonical products unconditionally to API response
6. **Generates** AI decisions with numeric grounding
7. **Renders** results in a comprehensive UI with chat support (Rank, FBA/FBM, Revenue, Units - no BSR on keyword cards)

The architecture prioritizes real data over estimates, routes canonical logic by input type (keyword vs ASIN), and provides a complete analysis experience for Amazon FBA sellers. Keyword analysis is designed to be permissive and never fail due to imperfect data, with guaranteed non-zero revenue/unit estimates through BSR-based or rank-based fallback. ASIN analysis maintains strict validation for precision. The UI displays clean, confident data with rank-based positioning (not BSR) for keyword analysis.

