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
- Data source routing: Selects listings based on `dataSource` flag
  - `dataSource === "market"` → Uses `analysis.page_one_listings`
  - `dataSource === "snapshot"` → Uses `analysis.market_snapshot.listings`

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
2. **Market Snapshot**: Aggregated metrics (avg price, reviews, BSR, etc.)
3. **PPC Indicators**: Ad intensity assessment
4. **Page 1 Results**: Product grid (Amazon-style cards)
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

#### Step 4: Canonical Page-1 Builder

**Location:** `lib/amazon/canonicalPageOne.ts`

**Purpose:** Transforms raw listings into standardized Page-1 product set

**Current State:** TEMPORARILY DISABLED - Pass-through mode (no filtering)

**Normal Operations:**
- Filters organic listings (excludes sponsored)
- Validates ASINs (rejects synthetic ESTIMATED-X)
- Sorts by revenue (descending)
- Re-ranks products
- Calculates revenue share percentages
- Applies BSR duplicate detection
- Applies Page-1 demand calibration
- Blends with ASIN-level historical data

**Input:** `ParsedListing[]`
**Output:** `CanonicalProduct[]`

**Key Fields:**
- `rank`, `asin`, `title`, `image_url`, `price`, `rating`, `review_count`
- `bsr`, `estimated_monthly_units`, `estimated_monthly_revenue`
- `revenue_share_pct`, `fulfillment`, `brand`, `seller_country`

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
buildCanonicalPageOne()
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
    ├─→ dataSource: "market"
    │    └─→ pageOneListings = analysis.page_one_listings
    │
    └─→ dataSource: "snapshot" | "estimated"
         └─→ pageOneListings = analysis.market_snapshot.listings
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

### Market Data Routing
- **Invariant**: If `dataSource === "market"`, then `rawRainforestListings.length > 0`
- **Guard**: Canonical Page-1 MUST run when `dataSource === "market"`
- **Guard**: No estimated products generated when `dataSource === "market"`
- **Assertion**: If `dataSource === "market"` and `listings.length === 0` → ERROR

### Canonical Page-1
- **Invariant**: Canonical products must have real ASINs (not ESTIMATED-X)
- **Guard**: Synthetic ASINs rejected (returns empty array)
- **Guard**: Only processes listings with `units_est` and `revenue_est`

### UI Rendering
- **Guard**: Page-1 grid hidden if `dataSource === "snapshot"` or `"estimated"`
- **Assertion**: If `dataSource === "market"` and `pageOneListings.length === 0` → ERROR

---

## 🧪 Debugging & Logging

### Forensic Trace Logs
- `🔍 STEP_1_RAW_RAINFOREST_DATA`: Raw Rainforest response
- `🔍 STEP_2_CANONICAL_PAGE1_INPUT`: Input to canonical builder
- `🔍 STEP_3_CANONICAL_PAGE1_OUTPUT`: Output from canonical builder
- `🔍 STEP_4_API_RESPONSE`: Final API response shape
- `🔍 STEP_5_UI_COMPONENT_RECEIVED`: UI component received data

### Debug Logs
- `🧪 RAW INPUT LISTINGS`: First 3 listings
- `🧪 CANONICAL INPUT COUNT`: Input count
- `🧪 CANONICAL OUTPUT COUNT`: Output count
- `🧪 CANONICAL FORCED OUTPUT COUNT`: Forced pass-through count

### Error Logs
- `🔴 FATAL`: Critical routing errors
- `🔴 CANONICAL_PAGE1_ERROR`: Canonical builder errors
- `🔴 MARKET DATASOURCE WITH ZERO LISTINGS`: UI routing bug

---

## 📊 Key Metrics & Calculations

### Revenue Estimation
- **BSR-to-Sales Model**: `units = 600000 / pow(bsr, 0.45)`
- **Revenue**: `units * price`
- **Calibration**: Top 3 BSRs used to calibrate total units

### Market Aggregates
- **Average Price**: Mean of all Page-1 prices
- **Average Rating**: Mean of all Page-1 ratings
- **Average BSR**: Mean of all Page-1 BSRs
- **Total Monthly Units**: Sum of all `estimated_monthly_units`
- **Total Monthly Revenue**: Sum of all `estimated_monthly_revenue`

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
1. **ASIN Analysis**: Support for direct ASIN input (currently keyword-only)
2. **Historical Blending**: Enhanced keyword-level history blending
3. **Search Volume**: Integration with SP-API search volume data
4. **Calibration Refinement**: Improved BSR-to-sales model
5. **Filter Re-introduction**: Re-add canonical Page-1 filters incrementally

---

## 📝 Notes

### Current State
- **Canonical Page-1**: Temporarily in pass-through mode (no filtering)
- **Market-First Architecture**: Fully implemented
- **UI Routing**: Fixed to use `dataSource` flag correctly
- **Fallback Prevention**: Enforced for market data

### Known Issues
- Canonical Page-1 filtering disabled for debugging
- Some synthetic ASINs may pass through (ESTIMATED-X)
- Historical blending may be incomplete for new keywords

---

## 🎯 Summary

The Analyze feature is a sophisticated product analysis system that:
1. **Fetches** real market data (Rainforest API) or falls back to snapshots
2. **Transforms** raw listings into canonical Page-1 products
3. **Builds** structured data contracts for AI consumption
4. **Generates** AI decisions with numeric grounding
5. **Renders** results in a comprehensive UI with chat support

The architecture prioritizes real data over estimates, enforces strict routing invariants, and provides a complete analysis experience for Amazon FBA sellers.

