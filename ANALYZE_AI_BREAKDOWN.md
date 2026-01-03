# Analyze AI System Breakdown

## Overview

The Analyze feature uses a **seller decision engine** (not a data reporter) that makes verdict-first decisions about Amazon product viability. The AI thinks and speaks like a senior Amazon seller making real capital allocation decisions.

---

## Architecture Flow

### 1. Request Processing (`app/api/analyze/route.ts`)

**Entry Point:** `POST /api/analyze`

**Steps:**
1. **Authentication & Authorization**
   - Validates user session
   - Checks seller profile exists (onboarding complete)
   - Validates usage limits (rate limiting)

2. **Input Validation**
   - Validates request body: `{ input_type: "keyword", input_value: string }`
   - Rejects ASIN inputs (keyword-only currently)
   - Normalizes keyword (lowercase, trimmed)

3. **Seller Context Extraction**
   - Loads seller profile: `stage`, `experience_months`, `monthly_revenue_range`
   - Structures context for AI prompt

---

### 2. Market Data Fetching

**Priority Order:**
1. **High Confidence Cache** (if confidence = "high")
   - Skips Rainforest API call
   - Uses cached `keyword_products` and `keyword_snapshots` (7-day freshness)
   - Rehydrates cache into `KeywordMarketData` format

2. **Normal Cache** (24-hour freshness)
   - Checks `keyword_products` table
   - If cache hit, rehydrates and uses cached data

3. **Rainforest API** (if no cache or cache expired)
   - Fetches live Page-1 search results
   - Processes listings into `ParsedListing[]` format
   - Builds `KeywordMarketSnapshot`

**Data Sources:**
- `fetchKeywordMarketSnapshot()` - Fetches from Rainforest API
- `keyword_products` table - Cached product listings
- `keyword_snapshots` table - Cached market aggregates

---

### 3. Canonical Page-1 Building

**Purpose:** Creates a single source of truth for Page-1 products

**Process:**
- `buildKeywordPageOne()` - Builds canonical product array
- Normalizes listings from multiple sources
- Handles sponsored vs organic ranking
- Tracks algorithm boost (products appearing multiple times)
- Creates `CanonicalProduct[]` array

**Output:**
- `page_one_listings` - Canonical Page-1 products
- `products` - Same data (backward compatibility)

---

### 4. Data Contract Building

**Purpose:** Structures all market data into a locked contract format for AI

**Process:**
- `buildKeywordAnalyzeResponse()` - Builds data contract
- Structures:
  - **Summary metrics**: avg_price, avg_rating, page1_product_count, etc.
  - **Products array**: Canonical Page-1 listings
  - **Market structure**: Competition intensity, review barrier, price compression, dominance
  - **Margin snapshot**: COGS assumptions, FBA fees, net margins
  - **Signals**: PPC indicators, fulfillment mix, etc.

**Output:** `KeywordAnalyzeResponse` object with `ai_context` field

---

### 5. AI Prompt Construction

**System Prompt:** `SYSTEM_PROMPT` constant (lines 14-327)

**Key Components:**

#### A. Core Identity
- **Role**: Seller decision engine (not data reporter)
- **Mindset**: Senior Amazon seller making capital allocation decisions
- **Tone**: Decisive, confident, seller-level judgment

#### B. Operating Principles
1. **Verdict-first decision making**
   - Every answer MUST begin with clear verdict (yes/no/conditional)
   - Never hedge with "we can't conclude" or "insufficient data"

2. **Market structure reasoning** (MANDATORY)
   - Frame ALL analysis in terms of:
     * Competition intensity
     * Review barrier
     * Price compression
     * Dominance concentration
   - Raw metrics ONLY support structure reasoning, never restated as lists

3. **Seller-level judgment**
   - Think like senior operator deciding whether to risk capital
   - Make decisions even with imperfect data
   - Never expose system limitations

4. **Actionable conclusions**
   - Every response MUST end with actionable takeaway, warning, or condition for success

#### C. Prohibitions
- Never say "we can't conclude", "insufficient data", "not available"
- Never restate raw metrics as lists
- Never ask follow-up questions (unless explicitly requested)
- Never expose system gaps or data limitations

#### D. Data Context Injection
- Appends `ai_context` from data contract to system prompt
- AI can ONLY use data from `ai_context` object
- Explicitly forbids inventing metrics

---

### 6. AI Call to OpenAI

**API:** OpenAI Chat Completions API

**Model:** `gpt-4o-mini`

**Configuration:**
- `temperature: 0.7` - Balanced creativity/consistency
- `response_format: { type: "json_object" }` - Forces JSON output

**Messages:**
1. **System Message**: Full system prompt + `ai_context` JSON
2. **User Message**: Seller context + keyword

**User Message Format:**
```
SELLER CONTEXT:
- Stage: {stage}
- Experience (months): {experience_months}
- Monthly revenue range: {monthly_revenue_range}

ANALYSIS REQUEST:
{keyword}
```

---

### 7. Response Processing

**Steps:**

1. **Parse JSON Response**
   - Removes markdown code blocks if present
   - Parses JSON from OpenAI response
   - Logs structure for debugging

2. **Validate Decision Contract**
   - `validateDecisionContract()` - Ensures all required keys exist
   - Required keys:
     * `decision` (verdict, confidence)
     * `executive_summary`
     * `reasoning` (primary_factors, seller_context_impact)
     * `risks` (competition, pricing, differentiation, operations)
     * `recommended_actions` (must_do, should_do, avoid)
     * `assumptions_and_limits`
     * `numbers_used`

3. **Normalize Risks**
   - `normalizeRisks()` - Ensures all 4 risk categories always present
   - Handles missing risk categories gracefully

4. **Apply Confidence Rules**
   - Keyword searches capped at 75% max confidence
   - Sparse data (< 5 listings) → max 40% confidence
   - Limited data (< 10 listings) → max 60% confidence
   - Tracks confidence downgrade reasons

5. **Map Numbers Used**
   - Extracts metrics from data contract
   - Maps to `numbers_used` format for AI transparency
   - Handles null values gracefully

---

### 8. Response Assembly

**Final Response Structure:**
```typescript
{
  success: true,
  analysisRunId: string,
  decision: {
    verdict: "GO" | "CAUTION" | "NO_GO",
    confidence: number,
    confidence_downgrades?: string[]
  },
  executive_summary: string,
  reasoning: {
    primary_factors: string[],
    seller_context_impact: string
  },
  risks: {
    competition: { level, explanation },
    pricing: { level, explanation },
    differentiation: { level, explanation },
    operations: { level, explanation }
  },
  recommended_actions: {
    must_do: string[],
    should_do: string[],
    avoid: string[]
  },
  assumptions_and_limits: string[],
  numbers_used: {
    avg_price, price_range, median_reviews,
    review_density_pct, brand_concentration_pct,
    competitor_count, avg_rating
  },
  market_snapshot: KeywordMarketSnapshot,
  margin_snapshot: MarginSnapshot,
  page_one_listings: CanonicalProduct[],
  products: CanonicalProduct[],
  aggregates_derived_from_page_one: {...}
}
```

---

## Key Design Principles

### 1. Decision Engine, Not Data Reporter
- AI makes verdicts, not just reports data
- Every response starts with clear decision
- Uses market structure reasoning, not metric lists

### 2. Market Structure Framework
All analysis frames in terms of:
- **Competition intensity**: How many entrenched players? Review barrier height?
- **Review barrier**: Average review counts indicate how hard it is to compete
- **Price compression**: Price range tightness signals margin pressure
- **Dominance concentration**: Top brand share indicates market lock-in risk

### 3. Seller Context Integration
- New sellers: Penalize high competition intensity, high review barriers
- Existing sellers: Allow higher competition if differentiation path exists
- Thinking mode: Educational focus on market structure concepts

### 4. Actionable Conclusions
- Every response ends with actionable takeaway, warning, or condition for success
- No open-ended analysis without direction

### 5. Data Contract Lock
- AI can ONLY use data from `ai_context` object
- No inventing metrics
- No referencing external data
- Missing data = null, never fabricated

---

## Data Flow Diagram

```
User Request (keyword)
    ↓
Authentication & Validation
    ↓
Check Cache (High Confidence → Skip Rainforest)
    ↓
Fetch Market Data (Rainforest API or Cache)
    ↓
Build Canonical Page-1 Products
    ↓
Build Data Contract (ai_context)
    ↓
Construct AI Prompt (System Prompt + ai_context)
    ↓
Call OpenAI API (gpt-4o-mini)
    ↓
Parse & Validate JSON Response
    ↓
Normalize Risks & Apply Confidence Rules
    ↓
Assemble Final Response
    ↓
Return to Frontend
```

---

## Error Handling

1. **Missing Data**: Uses fallbacks, never blocks response
2. **Invalid JSON**: Returns 500 with error details
3. **Contract Validation Failure**: Returns 500 with missing/extra keys
4. **OpenAI API Errors**: Returns 500 with API error details
5. **Cache Failures**: Falls back to Rainforest API

---

## Caching Strategy

1. **High Confidence Cache**: 7-day freshness, skips Rainforest
2. **Normal Cache**: 24-hour freshness, uses Rainforest if expired
3. **Cache Write**: After successful Rainforest fetch, upserts to `keyword_products` and `keyword_snapshots`

---

## Confidence Scoring

**Base Confidence**: From AI response (0-100)

**Applied Rules:**
- Keyword searches: Max 75%
- < 5 listings: Max 40%
- < 10 listings: Max 60%
- Review density > 60%: Max 65%
- Brand concentration > 50%: Max 60%

**Confidence reflects**: Decision certainty based on market structure clarity, NOT data completeness

---

## Key Files

- `app/api/analyze/route.ts` - Main API route, AI prompt, response processing
- `lib/analyze/dataContract.ts` - Data contract builder, `ai_context` structure
- `lib/amazon/keywordMarket.ts` - Market data fetching, snapshot building
- `lib/amazon/canonicalPageOne.ts` - Canonical Page-1 product builder
- `lib/analyze/normalizeRisks.ts` - Risk normalization utility

---

## Example AI Response Structure

```json
{
  "decision": {
    "verdict": "CAUTION",
    "confidence": 65
  },
  "executive_summary": "This is a CAUTION for new sellers. The review barrier is high (2,800 average reviews) and dominance concentration is strong (top brand controls 55% of listings), indicating entrenched competition that requires significant capital to overcome. Entry is only viable for existing sellers with established review velocity and clear differentiation strategy. Proceed only if you can commit to 6+ months of PPC spend and have a unique value proposition that breaks brand loyalty.",
  "reasoning": {
    "primary_factors": [
      "High review barrier (2,800 avg reviews) creates significant capital requirement",
      "Strong dominance concentration (55% top brand share) indicates brand loyalty barrier"
    ],
    "seller_context_impact": "For new sellers, the review barrier and dominance concentration make entry unviable without substantial capital commitment."
  },
  "risks": {
    "competition": {
      "level": "High",
      "explanation": "High competition intensity: 2,400 average reviews indicates a high review barrier. New listings must invest significant capital in PPC and review generation to compete, making this unsuitable for sellers without established review velocity."
    },
    "pricing": {
      "level": "Medium",
      "explanation": "Price compression: $12–$15 range signals tight margins and limited differentiation room. Sellers must compete on operational efficiency or find a unique angle, as price-based competition will erode margins quickly."
    },
    "differentiation": {
      "level": "High",
      "explanation": "High dominance concentration: Top brand controls 60% of listings, indicating strong brand loyalty. New entrants face an uphill battle breaking customer trust, requiring either superior product quality or aggressive marketing spend."
    },
    "operations": {
      "level": "Low",
      "explanation": "Operational complexity: 10 competitors on Page 1 indicates mature market with established fulfillment patterns. Sellers must match or exceed current service levels, requiring robust inventory management and fast fulfillment."
    }
  },
  "recommended_actions": {
    "must_do": [
      "Commit to 6+ months PPC spend to overcome review barrier",
      "Secure unique differentiation angle before entry"
    ],
    "should_do": [
      "Analyze top brand's weaknesses from review analysis",
      "Test differentiation strategy with small inventory first"
    ],
    "avoid": [
      "Entering without clear differentiation strategy",
      "Underestimating capital requirements for review generation"
    ]
  },
  "assumptions_and_limits": [
    "Assumes review barrier remains at current level",
    "Assumes seller can commit required capital",
    "Market structure may shift if new entrants enter"
  ],
  "numbers_used": {
    "avg_price": 13.50,
    "price_range": [12.00, 15.00],
    "median_reviews": 2800,
    "review_density_pct": null,
    "brand_concentration_pct": 55,
    "competitor_count": 10,
    "avg_rating": 4.5
  }
}
```

---

## Summary

The Analyze AI system is a **seller decision engine** that:
1. Fetches market data (Rainforest API or cache)
2. Builds canonical Page-1 products
3. Structures data into locked contract format
4. Calls OpenAI with seller decision engine prompt
5. Validates and normalizes AI response
6. Returns structured decision with market data

The AI makes verdict-first decisions based on market structure reasoning (competition intensity, review barriers, price compression, dominance concentration), not just reporting raw metrics. Every response ends with actionable guidance for the seller.

