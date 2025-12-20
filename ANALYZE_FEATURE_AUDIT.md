# Analyze Feature Completeness Audit

**Date:** 2025-01-17  
**Status:** Pre-Part G (Margin Snapshot Card) Assessment

---

## 1. INPUT HANDLING

### ASIN vs Keyword Detection
✅ **Complete**
- UI correctly maps `inputType` ("asin" | "keyword") to API `input_type` ("asin" | "idea")
- ASIN validation via `isValidASIN()` function (10 alphanumeric characters)
- Error messages shown for invalid ASIN format

### analysisMode Propagation
✅ **Complete**
- `analysisMode` derived from `input_type` in AnalyzeForm: `'ASIN' | 'KEYWORD' | null`
- Defensive assertions in development mode
- Passed to ChatSidebar component correctly
- Used throughout rendering logic to separate mode-specific UI

### Validation and Error Handling
✅ **Complete**
- Input validation before API call
- API returns 422 for missing keyword market data
- API returns 400 for invalid request body
- Frontend error display and loading states

---

## 2. DATA INGESTION

### Keyword: Page-1 Aggregation
✅ **Complete**
- `fetchKeywordMarketSnapshot()` called for `input_type === "idea"`
- Market snapshot includes: avg_price, avg_reviews, avg_rating, total_page1_listings, dominance_score, sponsored_count
- CPI calculated from Page-1 listings (seller-context aware)
- Listings array included in market_snapshot for frontend display
- Cached in `analysis_runs.response.market_snapshot`

### ASIN: Single-Listing Data Pull
🟡 **Partial**
- **CRITICAL GAP**: No explicit ASIN data fetching API call
- Code expects `asin_snapshot` from AI response (`decisionJson.asin_snapshot`)
- AI system prompt mentions ASIN analysis but doesn't enforce `asin_snapshot` in JSON contract
- Frontend interface defines `asin_snapshot` but code doesn't explicitly extract it from API response
- **GAP**: `analysisData` construction doesn't include `asin_snapshot` field (may be missing from frontend state)
- **Status**: Relies on AI to populate asin_snapshot in response, but no data source is fetched

### Caching Behavior
✅ **Complete**
- Market snapshot cached in `analysis_runs.response` (JSONB)
- `rainforest_data` stored separately for keyword analyses (backward compatibility)
- FBA fees cached via `resolveFbaFees()` with database caching
- No live API calls from chat (chat is fully grounded)

### Missing or Placeholder Metrics
🟡 **Partial**
- BSR: Not available in listings structure (shown as "—")
- Fulfillment mix: Returns placeholder {fba: 0, fbm: 0, amazon: 0} (data not in ParsedListing)
- ASIN snapshot: May be null if AI doesn't provide it (frontend has fallback rendering)

---

## 3. SNAPSHOT LOGIC

### Keyword Snapshot Blocks
✅ **Complete**
- 30-Day Revenue/Units estimation (from listings)
- Page-1 Product Table (sorted by revenue)
- Market Breakdown (Brand Dominance, Fulfillment Mix, Page-1 Density, Sponsored Presence)
- Market Snapshot cards (Price Band, Review Barrier, Quality Threshold, Brand Dominance, Page-1 Density, Paid Pressure, Fulfillment Cost)
- CPI display block (KEYWORD only)
- All blocks properly scoped with `analysisMode === 'KEYWORD'`

### ASIN Snapshot Blocks
🟡 **Partial**
- Review Moat (absolute reviews + classification) ✅
- Rating Strength ✅
- Price Anchor (absolute price) ✅
- Brand Power ✅
- Displacement Difficulty (from pressure_score) ✅
- BSR, Fulfillment (conditional rendering) ✅
- **GAP**: `asin_snapshot` may not exist if AI doesn't provide it
- Fallback rendering exists but shows "ASIN data unavailable" message
- **GAP**: No actual ASIN data source (relies on AI hallucination)

### Zero Leakage Between Modes
✅ **Complete**
- Defensive assertions prevent Page-1 averages in ASIN mode rendering
- Separate conditional blocks: `analysisMode === 'KEYWORD'` vs `analysisMode === 'ASIN'`
- CPI only shown for KEYWORD mode
- Market Snapshot cards only for KEYWORD mode
- ASIN Snapshot only for ASIN mode
- Verdict copy differentiates between modes

---

## 4. VERDICT + CONFIDENCE

### Keyword Verdict Rubric
✅ **Complete**
- System prompt includes keyword verdict guidelines
- Confidence rules: caps at 75%, downgrades for sparse data (< 5 listings → 40% max, < 10 → 60% max)
- CPI must be cited in strategic answers
- Market clarity drives confidence

### ASIN Verdict Rubric
✅ **Complete**
- System prompt includes ASIN verdict rubric (GO/CAUTION/NO_GO templates)
- Baseline confidence: 50%
- Positive adjustments: +10 (weak review moat), +10 (fragmented brand), +5 (seller alignment), +5 (price inefficiency)
- Negative adjustments: -15 (review moat > 5k), -15 (brand dominance > 50%), -20 (Amazon retail), -10 (ad-heavy), -10 (seller mismatch)
- Caps: 65% (brand-led), 60% (review moat > 1k), 50% (Amazon retail), 55% (insufficient data)

### Confidence Math Split
✅ **Complete**
- Separate confidence calculation paths for ASIN vs KEYWORD
- ASIN: Displacement feasibility (starts 50%, adjusts based on ASIN metrics)
- KEYWORD: Market clarity (starts from AI, capped at 75%, downgrades for data sparsity)
- Margin confidence tracked separately (ASIN: 70% baseline, separate downgrades)

### Hardcoded or Placeholder Confidence Logic
🟡 **Partial**
- ASIN confidence uses `marketSnapshot?.dominance_score` (Page-1 data) for adjustments
- **ISSUE**: ASIN mode shouldn't depend on Page-1 data for confidence, but code does use it for brand dominance checks
- Margin confidence rules implemented but not stored separately (only in code comments)

---

## 5. EXECUTIVE SUMMARY

### Mode-Aware Language
✅ **Complete**
- System prompt enforces mode-specific language rules
- ASIN mode: "this ASIN", "displacement", "competitive target"
- KEYWORD mode: "Page 1", "market", "aggregated signals"
- Forbidden phrases documented in prompt

### Seller-Profile Awareness
✅ **Complete**
- Seller context injected: stage, experience_months, monthly_revenue_range, sourcing_model
- System prompt includes seller context interpretation rules
- Seller context impact shown in reasoning section

### Generic or Reused Copy
🟡 **Partial**
- Executive summary generated by AI (no hardcoded templates)
- Risk explanations use AI-generated text (but must cite metrics)
- Recommended actions use AI-generated lists
- **Risk**: AI may still use generic language if not strictly enforced

---

## 6. RISK BREAKDOWN

### Trigger Logic Correctness
✅ **Complete**
- System prompt requires numeric triggers for each risk
- Risks must cite metrics from market_snapshot (KEYWORD) or ASIN data (ASIN)
- AI generates risks with level (Low/Medium/High) and explanation

### Mode-Specific Triggers
🟡 **Partial**
- System prompt mentions mode-specific triggers but relies on AI to implement
- No hardcoded trigger thresholds (all AI-generated)
- **Risk**: Inconsistent trigger logic between analyses

### Missing Signals
🟡 **Partial**
- Fulfillment data not available (placeholder logic)
- BSR not in listings structure
- ASIN snapshot data depends on AI providing it (no guaranteed source)

---

## 7. CHAT INTEGRATION

### Mode Awareness
✅ **Complete**
- Chat system prompt built with `buildChatSystemPrompt(analysisMode)`
- ASIN mode rules: Never say "insufficient Page-1 data", never ask for market aggregation
- KEYWORD mode rules: Market aggregation rules unchanged
- Mode passed from analyze API route to chat API route correctly

### No-Answer Guardrails
✅ **Complete**
- `canAnswerQuestion()` function checks for required data
- Strategic questions require CPI (KEYWORD mode)
- External data patterns blocked (BSR, sales volume, PPC costs, conversion rates)
- Refusal format enforced

### Hallucination Tripwires
✅ **Complete**
- `validateResponseForHallucination()` scans for forbidden phrases, unsupported metrics
- Allowed numbers extracted from context and validated
- Response correction with fallback message on tripwire trigger

### Snapshot Language Alignment
✅ **Complete**
- Chat uses same vocabulary as snapshots ("review moat", "price band", etc.)
- ASIN mode: "this ASIN", "this listing", "displacement"
- KEYWORD mode: "Page-1", "market density", "competitive density"

### Places Where Chat Still Asks for "Missing Data" Incorrectly
🟡 **Partial**
- Strategic questions in ASIN mode may incorrectly require CPI (CPI is KEYWORD-only)
- **GAP**: `canAnswerQuestion()` doesn't check `analysisMode` - always requires CPI for strategic questions
- Margin questions: System prompt handles proactively (proposes assumptions), but guardrails may still block

---

## 8. PERSISTENCE

### analysis_runs Schema Completeness
✅ **Complete** (assumed - schema not in codebase)
- Fields used: `id`, `user_id`, `input_type`, `input_value`, `ai_verdict`, `ai_confidence`, `seller_stage`, `seller_experience_months`, `seller_monthly_revenue_range`, `response` (JSONB), `rainforest_data` (JSONB)
- `response` contains full decision JSON including market_snapshot, asin_snapshot (if provided), margin_snapshot

### Saved Fields Actually Used Later
✅ **Complete**
- `response` used by chat API for context
- `rainforest_data` used by chat API (backward compatibility)
- All fields used for history/read-only view

### Unused or Dead Fields
✅ **Complete**
- No dead fields identified
- `rainforest_data` kept for backward compatibility but also stored in `response.market_snapshot`

---

## 9. KNOWN GAPS BEFORE PART G

### Data Missing That Margin Snapshot Will Require
🟡 **Partial**
- **ASIN Price**: Currently extracted from `asin_snapshot.price` or `market_data.average_price` or defaults to 25.0
  - **ISSUE**: If asin_snapshot is null, falls back to market_data (may not exist for ASIN mode)
  - **GAP**: No guaranteed ASIN price source
- **Category Hint**: Currently `null` for margin calculations
  - **GAP**: No category inference for ASIN mode (needed for FBA fee estimation)
- **FBA Fees**: Uses SP-API when available, estimates by category otherwise
  - **Status**: Implemented with fallback estimation

### Structural Changes Needed Before Adding Margins
❌ **None Identified**
- Margin snapshot calculation already implemented
- Margin snapshot stored in `market_snapshot.margin_snapshot`
- Frontend rendering already handles margin snapshot
- ASIN mode margin logic implemented with proper price extraction hierarchy

### Things That MUST Be Fixed Now vs Can Wait

**MUST FIX NOW:**
1. ❌ **ASIN Data Source**: No actual ASIN data fetching - relies on AI to provide asin_snapshot
   - **Impact**: ASIN snapshot may be empty/null, breaking ASIN mode rendering
   - **Fix**: Either fetch ASIN data from API, or ensure AI always provides asin_snapshot

2. ❌ **ASIN Snapshot Extraction**: Frontend doesn't extract asin_snapshot from API response
   - **Impact**: Even if AI provides asin_snapshot, it's not passed to frontend state
   - **Fix**: Add `asin_snapshot: data.decision.asin_snapshot || null` to analysisData construction

3. 🟡 **ASIN Confidence Logic**: Uses Page-1 data (marketSnapshot.dominance_score) for ASIN confidence
   - **Impact**: Violates "no Page-1 dependency" rule for ASIN confidence
   - **Fix**: Remove Page-1 data usage from ASIN confidence calculation

4. 🟡 **Chat Guardrails**: `canAnswerQuestion()` doesn't check analysisMode - always requires CPI for strategic questions
   - **Impact**: ASIN mode chat may incorrectly refuse to answer strategic questions
   - **Fix**: Make CPI requirement KEYWORD-only

**CAN WAIT:**
- Category hint inference (margin calculations work with null category)
- BSR data (not critical for margins)
- Fulfillment mix data (not used in margin calculations)

---

## BLOCKERS BEFORE PART G

1. **ASIN Data Source Missing** ❌
   - **Severity**: HIGH
   - **Reason**: ASIN mode cannot function reliably without actual ASIN data
   - **Blocking**: Yes - Margin snapshot needs ASIN price, which may not exist

2. **ASIN Snapshot Not Extracted in Frontend** ❌
   - **Severity**: HIGH
   - **Reason**: Even if API provides asin_snapshot, frontend doesn't extract it into analysis state
   - **Blocking**: Yes - Frontend rendering expects analysis.asin_snapshot but it's never populated

3. **ASIN Confidence Uses Page-1 Data** 🟡
   - **Severity**: MEDIUM
   - **Reason**: Violates architectural separation, but confidence calculation still works
   - **Blocking**: No - Functional issue, not a blocker for Part G

4. **Chat Guardrails Don't Check Mode** 🟡
   - **Severity**: LOW
   - **Reason**: May cause incorrect refusals but doesn't break functionality
   - **Blocking**: No - Can fix during Part G implementation

---

## SAFE TO PROCEED TO PART G: NO

**Reason:**
The ASIN data source gap is a **critical blocker**. Margin snapshot calculation requires ASIN price, which currently has no guaranteed source:
- Relies on AI to provide `asin_snapshot.price` (may not happen)
- Falls back to `market_data.average_price` (may not exist for ASIN mode)
- Finally defaults to 25.0 (breaks margin accuracy)

**Recommended Actions Before Part G:**
1. **Fix ASIN data ingestion** - Either:
   - Add explicit ASIN data fetching API call (Rainforest/SP-API)
   - Or ensure AI system prompt enforces asin_snapshot in JSON response contract
   - Or add ASIN price extraction from a reliable source

2. **Fix ASIN confidence Page-1 dependency** - Remove `marketSnapshot?.dominance_score` usage from ASIN confidence calculation

3. **Fix chat guardrails** - Add analysisMode check to `canAnswerQuestion()` to make CPI requirement KEYWORD-only

---

## SUMMARY

**Complete:** 70%  
**Partial:** 25%  
**Missing:** 5%

**Key Strengths:**
- Solid mode separation in UI rendering
- Proper confidence calculation logic (with minor issues)
- Good chat integration with mode awareness
- Margin calculation infrastructure ready

**Key Weaknesses:**
- No guaranteed ASIN data source (critical blocker)
- ASIN confidence still uses Page-1 data (architectural violation)
- Chat guardrails don't fully respect mode separation
