# Analyze Feature - End-to-End Breakdown

This document provides a comprehensive, up-to-date breakdown of how the Analyze feature works from request to response.

---

## Overview

The Analyze feature allows users to analyze Amazon keywords to evaluate market opportunities. It uses a **snapshot-first architecture** where precomputed market data is stored in the database, avoiding expensive API calls on every request.

---

## Request Flow

### 1. User Input
- User enters a keyword in the search box (`app/analyze/AnalyzeForm.tsx`)
- Frontend validates input and calls `POST /api/analyze`
- Request body: `{ input_type: "keyword", input_value: "<keyword>" }`

### 2. Authentication & Authorization (`POST /api/analyze`)

**Step 1: Authentication Check**
- Verifies user is authenticated via Supabase Auth
- Returns `401 Unauthorized` if not authenticated

**Step 2: Seller Profile Validation**
- Loads seller profile from `seller_profiles` table
- Must include: `stage`, `experience_months`, `monthly_revenue_range`, `sourcing_model`
- Optional fields: `goals`, `risk_tolerance`, `margin_target`, `max_fee_pct`
- Graceful fallback if new optional columns don't exist yet
- Returns `403 Forbidden` if profile doesn't exist (onboarding incomplete)

**Step 3: Usage Limit Check**
- Loads or creates usage counter from `usage_counters` table
- Default limit: 5 analyses per 30 days (configurable via `MAX_ANALYSES_PER_PERIOD`)
- Resets counter after `USAGE_PERIOD_DAYS` (30 days)
- Admin/dev email bypass available (via `shouldIncrementUsage()`)
- Returns `429 Too Many Requests` if limit exceeded

**Step 4: Request Body Validation**
- Validates JSON structure
- Rejects ASIN-like strings (pattern: `B0[A-Z0-9]{8}`)
- Ensures `input_type === "keyword"` and `input_value` is non-empty string
- Returns `400 Bad Request` if validation fails

---

## Snapshot-First Architecture

### Core Principle
All market data comes from precomputed snapshots stored in `keyword_snapshots` table. **No external API calls** are made during the analyze request (except for OpenAI AI call and optional FBA fee lookups).

### Snapshot Lookup

**Step 5: Snapshot Search**
```typescript
const snapshot = await searchKeywordSnapshot(supabase, keyword, marketplace);
```

- Searches `keyword_snapshots` table by normalized keyword + marketplace
- Normalizes keyword: `keyword.toLowerCase().trim()`
- Returns `null` if no snapshot exists

### Two Snapshot Tiers

#### **Tier-1: Instant Estimates** (No API calls, $0 cost)
- **When**: No snapshot exists in database
- **Created**: Immediately when snapshot is missing
- **Method**: Deterministic heuristic calculation
- **Fields**:
  - `product_count`: 48 (fixed estimate)
  - `average_price`: Based on keyword length (22-30 range)
  - `average_bsr`: 15000 (default)
  - `est_total_monthly_units_min/max`: Computed from `150 units/listing × product_count × 0.7/1.3`
  - `est_total_monthly_revenue_min/max`: Computed from units × average_price
- **Created by**: Analyze API itself (not worker)
- **Purpose**: Provide instant UI feedback while background enrichment happens

#### **Tier-2: Live Data** (Background worker, costs API credits)
- **When**: Background worker processes queued keywords
- **Created**: By keyword-worker Supabase Edge Function
- **Method**: Calls Rainforest API to fetch actual Page-1 listings
- **Fields**: Real product data (ASINs, titles, prices, reviews, BSR, etc.)
- **Purpose**: Replace Tier-1 estimates with real market data

---

## Data Processing Paths

### Path A: Snapshot Exists (Tier-2 or existing Tier-1)

**Step 6A: Read Snapshot & Products**
```typescript
const products = await getKeywordProducts(supabase, keyword, marketplace);
```

- Reads product listings from `keyword_products` table
- Filters products with valid prices for average calculation
- If snapshot lacks min/max fields (old snapshots):
  1. Computes min/max using deterministic logic
  2. Updates snapshot in database with computed values
  3. Logs update for future reads

**Step 6B: Build KeywordMarketData**
- Maps snapshot to `KeywordMarketData` format
- Computes min/max values if missing:
  - `est_units_per_listing = 150`
  - `total_units = page1_count × 150`
  - `units_min = total_units × 0.7`
  - `units_max = total_units × 1.3`
  - `revenue_min = units_min × avg_price`
  - `revenue_max = units_max × avg_price`
- Maps products to listings array (for UI display)
- Sets snapshot status to `'hit'`

### Path B: No Snapshot Exists (Tier-1 Creation)

**Step 6C: Create Tier-1 Snapshot**
```typescript
const tier1Snapshot = buildTier1Snapshot(normalizedKeyword);
const dbSnapshot = tier1ToDbFormat(tier1Snapshot, marketplace);
await supabase.from("keyword_snapshots").upsert(dbSnapshot);
```

- Builds Tier-1 snapshot using deterministic logic
- Computes min/max values immediately
- Upserts snapshot to database
- Queues keyword for Tier-2 enrichment (background, non-blocking)
- Sets snapshot status to `'estimated'`

**Step 6D: Build KeywordMarketData from Tier-1**
- Uses in-memory Tier-1 snapshot data
- Lists array is empty (no product-level data yet)
- All numeric fields populated (no nulls)

---

## Market Analysis

### Step 7: Build Data Contract Response

**Build Margin Snapshot**
```typescript
const marginSnapshot = buildMarginSnapshot({
  analysisMode: 'KEYWORD',
  sellerProfile: { sourcing_model },
  marketSnapshot: { avg_price, category },
  fbaFees: { total_fba_fees, source }
});
```

- Estimates COGS range based on sourcing model
- Fetches FBA fees (SP-API or estimated fallback)
- Computes margin estimates and breakeven prices
- Confidence tier: "EXACT", "REFINED", or "ESTIMATED"

**Build Contract Response**
```typescript
const contractResponse = buildKeywordAnalyzeResponse(
  keyword,
  keywordMarketData,
  marginSnapshot
);
```

- Creates structured response with:
  - Summary metrics (avg_price, avg_reviews, page1_count)
  - Products array (top 20 organic listings)
  - Market structure (brand dominance, price bands, fulfillment mix)
  - Margin snapshot
  - Signals (competition level, pricing pressure, etc.)
  - AI context (structured data for AI system prompt)

### Step 8: Competitive Pressure Index (CPI)

```typescript
const cpiResult = calculateCPI({
  listings: keywordMarketData.listings,
  sellerStage: sellerProfile.stage,
  sellerExperienceMonths: sellerProfile.experience_months
});
```

- Computes 0-100 score:
  - Review dominance (0-30 points)
  - Brand concentration (0-25 points)
  - Sponsored saturation (0-20 points)
  - Price compression (0-15 points)
  - Seller fit modifier (-10 to +10 points)
- Labels: "Low", "Moderate", "High", "Extreme"
- Injected into market snapshot

---

## AI Decision Generation

### Step 9: Build AI System Prompt

**System Prompt Structure:**
1. Core operating principles (conservatism, seller-specific reasoning)
2. Numeric grounding rules (must cite 2+ metrics)
3. Decision contract format (strict JSON schema)
4. Seller context interpretation rules
5. Confidence score justification rules
6. **AI Context Section**: Structured data from contract response
   - Market snapshot with all metrics
   - Products array
   - Market structure
   - Margin snapshot
   - Signals

**Key Rules:**
- Every verdict MUST reference at least 2 numeric signals
- Forbidden generic phrases without numbers
- Confidence caps based on data quality
- Executive summary must include 2+ metrics

### Step 10: Call OpenAI API

```typescript
const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
  model: "gpt-4o-mini",
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage }
  ],
  response_format: { type: "json_object" },
  temperature: 0.7
});
```

**User Message Format:**
```
SELLER CONTEXT:
- Stage: <stage>
- Experience (months): <experience_months>
- Monthly revenue range: <monthly_revenue_range>

ANALYSIS REQUEST:
<keyword>
```

### Step 11: Parse & Validate AI Response

**JSON Parsing:**
- Removes markdown code blocks if present
- Parses JSON content
- Validates structure matches `DecisionContract` interface

**Validation Checks:**
- All required keys present: `decision`, `executive_summary`, `reasoning`, `risks`, `recommended_actions`, `assumptions_and_limits`, `numbers_used`
- Decision object valid: verdict in ["GO", "CAUTION", "NO_GO"], confidence 0-100
- Reasoning structure valid
- Risks structure valid (4 categories: competition, pricing, differentiation, operations)
- Recommended actions structure valid
- Numbers used structure valid

Returns `500 Internal Server Error` if validation fails.

### Step 12: Apply Confidence Downgrades

**Keyword-Specific Rules:**
- Maximum confidence capped at 75% for keyword searches
- If page1 listings < 5: confidence MAX = 40
- If page1 listings < 10: confidence MAX = 60
- Applies downgrades and logs reasons

**Final Confidence:**
- Rounded to nearest integer
- Stored in `decisionJson.decision.confidence`
- Downgrade reasons stored in `decisionJson.confidence_downgrades`

---

## Response Construction

### Step 13: Build Final Response Structure

**Three-Layer Response:**

1. **Decision Layer** (AI output):
   - Verdict, confidence, executive summary
   - Reasoning, risks, recommended actions
   - Assumptions and limits
   - Numbers used
   - Market snapshot (for UI access)
   - Margin snapshot

2. **Data Contract Layer** (Structured data):
   - Raw market data (no scores/verdicts)
   - Products array
   - Market structure
   - Summary metrics
   - AI context object

3. **Keyword Market Layer** (UI-optimized):
   - Market snapshot with all fields guaranteed (no nulls)
   - Listings array mapped for UI display
   - Search volume estimates
   - Fulfillment mix with source tracking

**Response Merging:**
```typescript
const finalResponse = {
  input_type: "keyword",
  decision: { ...decisionJson, market_snapshot, margin_snapshot },
  ...contractResponse,  // Data contract layer
  ...keywordMarket      // UI layer
};
```

### Step 14: Build KeywordMarket Object

**Guaranteed Fields (No Nulls):**
- `search_volume`: { min, max, source, confidence }
- `avg_reviews`: number (0 if none)
- `avg_price`: number (0 if none)
- `avg_rating`: number (0 if none)
- `fulfillment_mix`: { fba, fbm, amazon, source }
- `page1_count`: number
- `est_total_monthly_units_min/max`: number
- `est_total_monthly_revenue_min/max`: number

**Search Volume Priority:**
1. From `snapshot.search_demand` (historical/cached)
2. From estimator using real listings (if listings exist)
3. Fallback estimator (if no listings)

**Listings Mapping:**
- Maps `keywordMarketData.listings` to UI format
- Normalizes listing data
- Includes revenue/units estimates
- Falls back to `contractResponse.products` if keywordMarket listings empty

---

## Database Storage

### Step 15: Save Analysis Run

**Clean Response:**
- Removes `undefined` values (PostgreSQL JSONB doesn't handle undefined)
- Serializes to JSON string
- Validates serialization succeeds

**Insert to `analysis_runs` table:**
```typescript
{
  user_id: user.id,
  input_type: "keyword",
  input_value: keyword,
  ai_verdict: finalResponse.decision.verdict,
  ai_confidence: finalResponse.decision.confidence,
  seller_stage: sellerProfile.stage,
  seller_experience_months: sellerProfile.experience_months,
  seller_monthly_revenue_range: sellerProfile.monthly_revenue_range,
  response: cleanedResponse  // Full JSON response
}
```

**Error Handling:**
- Logs detailed error if insert fails
- Attempts to serialize response to check for issues
- Returns `500 Internal Server Error` if save fails

### Step 16: Increment Usage Counter

- Updates `usage_counters.analyze_count += 1`
- Only increments if not bypassing limits
- Logs error but doesn't fail request if increment fails (non-critical)

### Step 17: Insert Market Observation

**Purpose**: Training data for self-improving estimators

**Data Stored:**
- Marketplace, keyword, normalized keyword
- Page number (always 1)
- Listings JSON
- Summary JSON (aggregates)
- Estimator inputs/outputs JSON
- Data quality metrics

**Non-Critical:**
- Errors logged but don't fail request
- Used for future model training

---

## Response Return

### Step 18: Build Success Response

```typescript
return NextResponse.json({
  success: true,
  status: "complete",
  data_quality: {
    snapshot: snapshotStatus,  // 'hit' | 'estimated' | 'miss'
    source: isEstimated ? 'estimated' : 'precomputed',
    fallback_used: false,
    estimated: isEstimated
  },
  estimated: isEstimated,
  dataSource: isEstimated ? "estimated" : "snapshot",
  snapshotType: isEstimated ? "estimated" : "snapshot",
  queued: isEstimated,  // Background job queued when using estimates
  message: isEstimated ? "Estimated market data. Refining with live data…" : undefined,
  analysisRunId: insertedRun.id,
  decision: finalResponse  // Complete analysis response
}, { status: 200 });
```

**Response Headers:**
- `x-sellerev-snapshot`: snapshot status for debugging

**Always Returns 200:**
- Even for estimated data (Tier-1)
- UI handles `estimated` flag to show appropriate messaging
- Never returns 422 (deprecated)

---

## Error Handling

### Catch Block
```typescript
catch (err) {
  console.error("ANALYZE_ERROR", { error, message, stack });
  return NextResponse.json({
    success: false,
    status: "error",
    error: "Internal analyze error",
    details: errorMessage,
    data_quality: {
      snapshot: isProcessingError ? "processing_error" : "error",
      reason: isProcessingError ? "processing_error" : "internal_error",
      fallback_used: false
    }
  }, { status: 500 });
}
```

**Error Classification:**
- Processing errors (from external APIs)
- Internal errors (code/logic errors)

---

## Key Design Decisions

### 1. Snapshot-First Architecture
- **Why**: Cost control, speed, reliability
- **How**: All market data precomputed and cached
- **Benefit**: Instant responses, $0 cost per request (after initial snapshot)

### 2. Two-Tier System
- **Tier-1**: Instant estimates (deterministic, no API calls)
- **Tier-2**: Live data (background worker, API costs)
- **Benefit**: Always have data to show, progressively improve with real data

### 3. Analyze API is Source of Truth for Tier-1
- Worker only handles Tier-2 enrichment
- Analyze API creates and updates Tier-1 snapshots
- Ensures UI always has numeric values (never null/undefined)

### 4. Deterministic Min/Max Calculation
- Formula: `150 units/listing × page1_count × 0.7/1.3 multipliers`
- Consistent across all Tier-1 snapshots
- Always generates numeric values (no nulls)

### 5. Data Contract Layer
- Separates raw data from AI interpretation
- Ensures data consistency across UI and AI
- Allows UI to display data-first, AI to reason on structured data

### 6. Always Return 200
- Even for estimated data
- UI handles data quality flags
- No ambiguous error states

---

## Data Flow Diagram

```
User Input (keyword)
    ↓
Authentication & Authorization
    ↓
Usage Limit Check
    ↓
Snapshot Lookup
    ├─→ Snapshot Found → Read Products → Build KeywordMarketData
    └─→ No Snapshot → Create Tier-1 → Queue for Tier-2 → Build KeywordMarketData
    ↓
Build Margin Snapshot (COGS, FBA fees)
    ↓
Build Contract Response (structured data)
    ↓
Calculate CPI (competitive pressure)
    ↓
Build AI System Prompt (include contract data)
    ↓
Call OpenAI API
    ↓
Parse & Validate AI Response
    ↓
Apply Confidence Downgrades
    ↓
Build Final Response (3 layers)
    ↓
Save to analysis_runs
    ↓
Increment Usage Counter
    ↓
Insert Market Observation (training data)
    ↓
Return 200 Response
```

---

## Response Structure Example

```json
{
  "success": true,
  "status": "complete",
  "data_quality": {
    "snapshot": "hit",
    "source": "precomputed",
    "fallback_used": false,
    "estimated": false
  },
  "estimated": false,
  "dataSource": "snapshot",
  "snapshotType": "snapshot",
  "queued": false,
  "analysisRunId": "uuid-here",
  "decision": {
    "verdict": "CAUTION",
    "confidence": 65,
    "executive_summary": "...",
    "reasoning": { ... },
    "risks": { ... },
    "recommended_actions": { ... },
    "assumptions_and_limits": [ ... ],
    "numbers_used": { ... },
    "market_snapshot": { ... },
    "margin_snapshot": { ... }
  },
  "products": [ ... ],
  "summary": { ... },
  "market_structure": { ... },
  "market_snapshot": { ... }
}
```

---

This breakdown covers the complete Analyze feature flow from request to response, including the snapshot-first architecture, two-tier system, AI decision generation, and response construction.

