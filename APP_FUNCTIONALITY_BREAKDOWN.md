# Sellerev Application Functionality Breakdown

This document provides a comprehensive overview of how the Sellerev application functions, from user onboarding through all core features.

---

## 1. ONBOARDING FLOW

### Entry Point & Authentication
- Users must authenticate via Supabase Auth (`/auth` page)
- Middleware (`middleware.ts`) enforces authentication and onboarding completion
- If user is not authenticated → redirected to `/auth`
- If authenticated but no profile exists → redirected to `/onboarding`

### Onboarding Process (`app/onboarding/page.tsx`)
**Required Fields:**
1. **Stage** (`stage`): One of:
   - `"new"` - Just starting
   - `"existing"` - Existing seller
   - `"scaling"` - Scaling brand

2. **Experience** (`experience_months`): Number of months selling on Amazon (optional integer)

3. **Monthly Revenue Range** (`monthly_revenue_range`): One of:
   - `"pre-revenue"`, `"<$5k"`, `"$5k-$10k"`, `"$10k-$50k"`, `"$50k-$100k"`, `"$100k+"`

4. **Sourcing Model** (`sourcing_model`): One of:
   - `"private_label"` - Private Label (manufactured / Alibaba)
   - `"wholesale_arbitrage"` - Wholesale / Arbitrage
   - `"retail_arbitrage"` - Retail Arbitrage
   - `"dropshipping"` - Dropshipping
   - `"not_sure"` - Not sure yet

**Storage:**
- Profile is stored in `seller_profiles` table via Supabase
- Uses `upsert` with `onConflict: "id"` to create or update profile
- User ID is the primary key (from Supabase Auth)

**Completion:**
- Upon successful submission → redirects to `/dashboard`
- Middleware checks for `sourcing_model` field existence to determine completion
- Once profile exists with `sourcing_model`, user cannot access `/onboarding` or `/auth` (redirected to `/dashboard`)

---

## 2. ANALYZE FUNCTIONALITY

### Overview
The Analyze page (`app/analyze/page.tsx`) is the core feature where users analyze Amazon keywords to evaluate market opportunities.

### User Flow
1. **Input**: User enters a keyword in the search box
2. **Analysis Request**: Frontend calls `/api/analyze` with `input_type: "keyword"` and `input_value: <keyword>`
3. **Processing**: Backend fetches market data and generates AI decision
4. **Display**: Results shown in UI with market snapshot, listings, and AI verdict
5. **History**: Analysis is saved to `analysis_runs` table

### API Route (`app/api/analyze/route.ts`)

#### Step 1: Authentication & Authorization
- Verifies user authentication
- Checks for seller profile (onboarding completion)
- Loads latest seller profile with all fields (with graceful fallback for missing columns)

#### Step 2: Usage Limits
- Checks usage counter (`usage_counters` table)
- Limits: 20 analyses per 30-day period (configurable via `USAGE_PERIOD_DAYS`)
- Admin/dev email bypass available (configurable via env vars)

#### Step 3: Market Data Fetching (`lib/amazon/keywordMarket.ts`)
**Rainforest API Integration:**
- Fetches Amazon search results for keyword via Rainforest API
- Extracts listings from `search_results`, `organic_results`, `ads`, or `results` arrays
- Parses product data: ASIN, title, price, rating, reviews, BSR, fulfillment type, sponsored status
- Computes market aggregates:
  - Average price, reviews, rating, BSR
  - Sponsored count and percentage
  - Fulfillment mix (FBA/FBM/Amazon)
  - Brand dominance score
  - Revenue estimates (using BSR-to-sales calculator)

**PPC Indicators:**
- Computes sponsored density, review barrier, price competition, dominance
- Labels ad intensity as "Low", "Medium", or "High"
- Generates signal bullets (max 3 reasons)

**Competitive Pressure Index (CPI):**
- Calculates 0-100 score based on:
  - Review dominance (0-30 points)
  - Brand concentration (0-25 points)
  - Sponsored saturation (0-20 points)
  - Price compression (0-15 points)
  - Seller fit modifier (-10 to +10 points based on seller profile)
- Labels: "Low", "Moderate", "High", or "Extreme"

#### Step 4: FBA Fee Estimation
- Attempts to fetch actual FBA fees via SP-API (`lib/spapi/resolveFbaFees.ts`)
- Caches fees in `fba_fee_cache` table (per ASIN/price combination)
- Falls back to size-tier heuristics if SP-API unavailable

#### Step 5: Margin Snapshot (`lib/margins/buildMarginSnapshot.ts`)
- Estimates COGS range based on:
  - Sourcing model (private label, wholesale, etc.)
  - Category
  - Average price
- Computes margin estimates:
  - Estimated COGS min/max
  - Estimated net margin range
  - Breakeven price
  - Confidence tier: "EXACT", "REFINED", or "ESTIMATED"

#### Step 6: AI Decision Generation
- Calls OpenAI with:
  - System prompt (conservative, seller-specific advisory tone)
  - Market snapshot data
  - Seller profile context
  - Required JSON structure for decision
- Generates:
  - Verdict: "GO", "CAUTION", or "NO_GO"
  - Confidence score (0-100)
  - Executive summary
  - Reasoning (primary factors, seller context impact)
  - Risks (competition, pricing, differentiation, operations)
  - Recommended actions (must do, should do, avoid)
  - Assumptions and limitations
  - Numbers used (explicit numeric grounding)

#### Step 7: Response Construction (`lib/analyze/dataContract.ts`)
- Builds contract-compliant response with:
  - Decision object
  - Market snapshot
  - Margin snapshot
  - Listings array
  - AI context (structured data for chat)
  - Source metadata

#### Step 8: Database Storage
- Saves to `analysis_runs` table:
  - `user_id` (from authenticated user)
  - `input_type`: "keyword"
  - `input_value`: the keyword searched
  - `ai_verdict`: "GO" | "CAUTION" | "NO_GO"
  - `ai_confidence`: 0-100 number
  - `seller_stage`, `seller_experience_months`, `seller_monthly_revenue_range`: snapshot of profile at analysis time
  - `response`: Full analysis response (JSON)
  - `rainforest_data`: Raw Rainforest API response (for reference)

#### Step 9: Usage Counter Update
- Increments `analyze_count` in `usage_counters` table
- Resets counter after `USAGE_PERIOD_DAYS` (30 days default)

### UI Display (`app/analyze/AnalyzeForm.tsx`)

**Market Snapshot Hero Section:**
- 30-Day Page-1 Revenue (estimated)
- 30-Day Page-1 Units (estimated)
- Avg BSR
- Avg Price
- Footer note: "Estimates based on Page-1 BSR sales modeling"

**Market Concentration Sub-Row:**
- Top-10 Revenue
- Top-10 Revenue Share (%)
- Review Barrier (average reviews of top 10 listings by revenue)

**Page 1 Results Grid:**
- Product cards showing:
  - Title, image, price, rating, reviews, BSR
  - **Revenue Block** (new):
    - Est. Monthly Revenue (bold, largest)
    - Est. Monthly Units
    - Share of Page Revenue (%)
- Default sorting: Estimated Monthly Revenue (descending)
- User can sort by: Revenue, Units, BSR, Reviews, Price

**PPC Panel:**
- Sponsored Density (Low/Med/High)
- Likely Ad Intensity label
- Key Signals (max 3 bullets)

**Feasibility Calculator:**
- Standalone non-AI calculator (see Section 6)

---

## 3. AI CHAT SYSTEM

### Overview
The AI chat (`app/analyze/ChatSidebar.tsx`) provides contextual assistance about the current analysis. It operates on **cached data only** - never makes live API calls.

### Core Principle: Anti-Hallucination Design
- Chat can ONLY reference data already stored in `analysis_runs.response`
- Original analysis verdict is marked as "AUTHORITATIVE"
- System prompt explicitly forbids inventing numbers or data
- All claims must cite specific fields from `ai_context`

### Chat Flow (`app/api/chat/route.ts`)

#### Step 1: Authentication & Analysis Lookup
- Verifies user authentication
- Fetches `analysis_runs` record by `analysisRunId`
- Ensures user owns the analysis (security check)

#### Step 2: Seller Profile Loading
- Loads latest seller profile (including new fields: `goals`, `risk_tolerance`, `margin_target`, `max_fee_pct`, `updated_at`)
- Graceful fallback if new columns don't exist yet (for migration compatibility)

#### Step 3: Seller Memory Loading
- Loads or creates `seller_memory` record (`seller_memory` table)
- Memory structure includes:
  - `seller_profile`: Stage, experience, revenue range, sourcing model, capital constraints, risk tolerance, target margin, long-term goal
  - `preferences`: Data vs summary preference, scores-only dislike, H10-style numbers, pricing sensitivity
  - `saved_assumptions`: Default COGS %, launch budget, ACOS target
  - `historical_context`: Analyzed keywords, ASINs, rejected/accepted opportunities
- Merges seller profile data into memory if profile exists
- Updates historical context (records analyzed keyword)

#### Step 4: Structured Memories Loading
- Loads confirmed memories from `seller_memories` table (structured memory system)
- Loads pending memories that need user confirmation
- These are factual business details extracted from conversations

#### Step 5: Conversation History
- Fetches all `analysis_messages` for this analysis run
- Ordered by `created_at` ascending
- Ensures continuity across sessions

#### Step 6: Cost Refinement Detection
- Detects if user message contains COGS or FBA fee refinements
- Example: "My COGS is actually $10" or "FBA fee is $3.50"
- If detected:
  - Updates `margin_snapshot` in analysis response
  - Recalculates margins
  - Persists updated response to `analysis_runs.response`
  - AI uses refined costs in future responses

#### Step 7: Context Building (`buildContextMessage`)
Builds comprehensive context message with:

1. **Original Analysis Summary:**
   - Input type and value
   - AI verdict and confidence (marked as AUTHORITATIVE)
   - Executive summary
   - Confidence downgrades (if any)

2. **Seller Context (Latest Profile):**
   - Stage, experience, revenue range, sourcing model
   - Goals, risk tolerance, margin target, max fee % (if set)
   - Profile version (`updated_at` timestamp)
   - Note: Always loaded fresh - changes take effect immediately

3. **Market Snapshot:**
   - Keyword, avg price, avg reviews, avg rating, page1 count
   - Sponsored count, fulfillment mix
   - CPI score and breakdown
   - PPC indicators
   - Representative ASIN (for fee estimation)

4. **Listings Array:**
   - Top listings with: ASIN, title, price, rating, reviews, BSR, fulfillment, sponsored status, revenue estimates

5. **Margin Snapshot:**
   - Estimated COGS range
   - Estimated net margin range
   - Breakeven price
   - Confidence tier and source

6. **Selected Listing (if provided):**
   - User-selected listing details for focused questions

7. **COGS Reference:**
   - COGS range and confidence (from margin snapshot or computed)
   - Sourcing model context

#### Step 8: System Prompt Building (`lib/ai/chatSystemPrompt.ts`)
System prompt enforces strict rules:

**Non-Negotiable Data Citation Rule:**
- May ONLY make claims supported by fields in `ai_context`
- Must say "estimated" or "modeled" if field is estimated
- Must say "not available" if field is missing
- NO EXCEPTIONS

**Hard Rules:**
1. Never output confidence scores or verdicts unless explicitly asked
2. Never contradict yourself
3. Never answer profitability questions without product-level COGS
4. Never imply Amazon-reported data when values are modeled
5. Never introduce numbers not in analysis data
6. **Never calculate margins/fees yourself - direct to Feasibility Calculator**
7. **Never give personalized investment directives**
8. Never give generic FBA advice unless grounded in Page-1 data
9. Never infer brand counts, fulfillment mix, sales without explicit fields

**Answer Structure (Required):**
- **Observed from Page 1**: What the data shows
- **What that suggests**: Implications
- **What we cannot conclude**: Limitations

**Specific Question Handling:**
- "How many brands?": Check for brand fields; if missing, say not available and offer alternatives
- "How can I differentiate?": Only reference observable gaps from Page-1 data

**When to Speak vs Stay Quiet:**
- **Speak**: User asks question, clicks listing, highlights metric, clicks "Explain"
- **Stay Quiet**: Initial page load, data refresh, passive browsing

**Follow-Up Questions:**
- Max 2 grounded prompts after answer
- Examples: "Do you want to compare the top 3 listings?", "Should we look at pricing clusters?"
- NOT: "Would you like to launch this product?"

#### Step 9: AI Response Generation
- Calls OpenAI with:
  - System prompt (from Step 8)
  - Context message (from Step 7)
  - Conversation history
  - User's current message
- Streams response to frontend
- Applies financial directive filter (see below)

#### Step 10: Financial Directive Filtering (`lib/ai/financialDirectiveFilter.ts`)
Post-processing step that sanitizes responses:

**Patterns Detected:**
- "you should invest $X"
- "spend $X"
- "borrow $X" / "take a loan of $X"
- "put in $X"
- General directives without amounts

**Replacement:**
- Replaces with: "If you have a budget in mind, we can model scenarios at different spend levels"
- Or: "Consider modeling scenarios at different budget levels"

**Purpose:**
- Prevents AI from giving direct financial directives
- Allows discussion of budgets, ROI frameworks, sensitivity analysis
- Maintains neutral, analytical tone

#### Step 11: Response Saving
- Saves user message and assistant response to `analysis_messages` table
- Links to `analysis_run_id` for conversation threading
- Updates seller memory if historical context changed

#### Step 12: Memory Updates (Pending Confirmation)
- If AI detects new business facts, creates pending memory records
- User sees confirmation prompt in chat UI
- User can "Save it" or "Don't save"
- Confirmed memories saved to `seller_memories` table

### UI Features
- **Suggested Questions**: Shown when no messages exist (quiet by default)
- **Streaming Response**: Real-time token streaming for responsive feel
- **Source Citations**: Shows data sources when available
- **Helper Text**: "Explains the visible Page-1 data only"

---

## 4. HISTORY PERSISTENCE

### Storage Structure

**Primary Table: `analysis_runs`**
- Stores each analysis run permanently
- Columns:
  - `id` (UUID, primary key)
  - `user_id` (foreign key to auth.users)
  - `input_type`: "keyword" (currently only keyword supported)
  - `input_value`: The keyword searched
  - `created_at`: Timestamp
  - `ai_verdict`: "GO" | "CAUTION" | "NO_GO"
  - `ai_confidence`: 0-100 number
  - `seller_stage`, `seller_experience_months`, `seller_monthly_revenue_range`: Snapshot of profile at analysis time
  - `response`: Full analysis response (JSON) - includes market snapshot, margin snapshot, listings, AI context
  - `rainforest_data`: Raw Rainforest API response (for debugging/reference)

**Secondary Table: `analysis_messages`**
- Stores chat conversation history
- Columns:
  - `id` (UUID, primary key)
  - `analysis_run_id` (foreign key to analysis_runs)
  - `role`: "user" | "assistant"
  - `content`: Message text
  - `created_at`: Timestamp
- Ordered by `created_at` for conversation reconstruction

### History Page (`app/history/page.tsx`)
- Server component that fetches analysis runs
- Query: `SELECT * FROM analysis_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
- Displays:
  - Keyword searched
  - Verdict badge (color-coded: green=GO, yellow=CAUTION, red=NO_GO)
  - Confidence score
  - Date formatted (e.g., "2 days ago")
  - Link to reopen analysis (`/analyze?id=<analysis_run_id>`)

### Analysis Reopening
- URL: `/analyze?id=<analysis_run_id>`
- Server component (`app/analyze/page.tsx`) checks for `id` query param
- Fetches `analysis_runs` record
- Transforms database record back to `AnalysisResponse` interface
- Loads chat messages from `analysis_messages` table
- Displays full analysis UI with:
  - Market snapshot
  - Listings grid
  - Feasibility calculator (with defaults from market snapshot)
  - Chat sidebar (with conversation history restored)

### Data Immutability
- Analysis runs are **never modified** after creation
- Chat messages are **append-only**
- Margin snapshot refinements update `analysis_runs.response.margin_snapshot` (but original analysis is preserved)
- This ensures:
  - Historical accuracy
  - Ability to reference original verdict
  - Conversation continuity
  - No silent data changes

---

## 5. SETTINGS AFFECTING AI

### Settings Page (`app/settings/page.tsx`)
Tabbed interface with multiple settings categories.

### Profile Tab (`app/settings/tabs/ProfileTab.tsx`)

**Editable Fields:**
1. **Stage** (`stage`): "new" | "existing" | "scaling"
2. **Experience Months** (`experience_months`): Integer or null
3. **Monthly Revenue Range** (`monthly_revenue_range`): Pre-defined ranges
4. **Sourcing Model** (`sourcing_model`): "private_label" | "wholesale_arbitrage" | "retail_arbitrage" | "dropshipping" | "not_sure"
5. **Goals** (`goals`): Free-text field (new)
6. **Risk Tolerance** (`risk_tolerance`): Free-text field (new)
7. **Margin Target** (`margin_target`): Number (percentage, e.g., 25.5) (new)
8. **Max Fee %** (`max_fee_pct`): Number (percentage, e.g., 30.0) (new)

**Storage:**
- All fields stored in `seller_profiles` table
- Uses `upsert` with `onConflict: "id"`
- `updated_at` timestamp automatically updated via database trigger

**AI Impact:**
- Profile is **always loaded fresh** in both Analyze and Chat APIs
- Profile version (`updated_at`) included in AI context
- AI system prompt includes:
  ```
  === SELLER CONTEXT (LATEST PROFILE) ===
  Stage: <stage>
  Experience: <experience_months> months
  Revenue Range: <monthly_revenue_range>
  Sourcing Model: <sourcing_model>
  Goals: <goals> (if set)
  Risk Tolerance: <risk_tolerance> (if set)
  Margin Target: <margin_target>% (if set)
  Max Fee %: <max_fee_pct>% (if set)
  Profile Version: <updated_at>
  ```

**How Settings Affect AI:**
1. **Stage**: Influences conservatism level (new sellers get more cautious advice)
2. **Experience**: Affects explanation depth (new sellers get more basic explanations)
3. **Revenue Range**: Contextualizes capital constraints
4. **Sourcing Model**: Used for COGS estimation (different models = different COGS ranges)
5. **Goals**: AI can reference stated goals when giving recommendations
6. **Risk Tolerance**: Affects how AI frames risk levels
7. **Margin Target**: AI can reference when discussing profitability
8. **Max Fee %**: AI can warn if fees exceed this threshold

**Immediate Effect:**
- Changes take effect **immediately** in new analyses and chat sessions
- No need to refresh or restart
- Profile is loaded on every API call (Analyze and Chat)

### Seller Memory System
Separate from profile settings, there's a `seller_memory` system:

**Structure:**
- `seller_profile`: Mapped from `seller_profiles` table
- `preferences`: Data presentation preferences (not yet exposed in UI)
- `saved_assumptions`: Default COGS, launch budget, ACOS target (not yet exposed in UI)
- `historical_context`: Track of analyzed keywords, rejected/accepted opportunities

**How It Affects AI:**
- Memory is loaded in chat system prompt
- AI can reference:
  - Past analyzed keywords (to avoid repeating advice)
  - Rejected opportunities (to understand user preferences)
  - Saved assumptions (when making recommendations)

**Memory Updates:**
- Can be updated via chat (user confirmation required)
- Can be updated via explicit user statements
- Never overwrites historical data
- Always requires explicit confirmation for irreversible updates

---

## 6. FEASIBILITY CALCULATOR

### Overview
The Feasibility Calculator (`app/analyze/FeasibilityCalculator.tsx`) is a **non-AI, client-side calculator** for margin calculations. It allows users to edit assumptions and instantly see margin changes.

### Component Props
- `defaultPrice`: Average page-1 price (from market snapshot)
- `categoryHint`: Category name (for referral fee default and FBA fee estimation)
- `representativeAsin`: Representative ASIN from market snapshot (for SP-API fee lookup)

### Input Fields

1. **Target Price ($)**
   - Default: `defaultPrice` prop (or 25.0 if not provided)
   - Updates when `defaultPrice` prop changes

2. **COGS Low (%)**
   - Default: 40%
   - Range: 0-100%

3. **COGS High (%)**
   - Default: 65%
   - Range: 0-100%

4. **Shipping Mode**
   - Options: "air" | "sea" | "none"
   - Default: "air"

5. **Shipping Cost per kg ($)**
   - Defaults based on mode:
     - Air: $8.00/kg
     - Sea: $2.50/kg
     - None: $0
   - User-editable

6. **Weight (kg)** (optional)
   - For shipping cost calculation
   - For FBA fee estimation (size-tier)

7. **Dimensions (cm)** (optional)
   - Length, Width, Height
   - For FBA fee estimation (size-tier)

8. **Referral Fee (%)**
   - Default: Category-based (via `getReferralFeePctByCategory`)
     - Electronics: 8%
     - Clothing: 17%
     - Default: 15%
   - Updates when `categoryHint` prop changes

### FBA Fee Fetching

**Priority Order:**
1. **SP-API** (`/api/fba-fees`):
   - If `representativeAsin` and `target_price` provided
   - Calls `resolveFbaFees` which:
     - Checks `fba_fee_cache` table first
     - If cache miss, calls Amazon SP-API
     - Caches result in database
   - Returns actual fulfillment fee
   - Shows source as "sp_api"

2. **Estimated** (fallback):
   - If SP-API unavailable or ASIN missing
   - Uses size-tier heuristics based on:
     - Weight (if provided)
     - Dimensions (if provided)
     - Category hint
   - Shows source as "estimated" and displays "(est.)" label

### Calculations

**Landed Cost:**
```
landed_cost_low = (target_price * cogs_low_pct / 100) + shipping_cost
landed_cost_high = (target_price * cogs_high_pct / 100) + shipping_cost
```

**Shipping Cost:**
```
If ship_mode !== "none" AND weight_kg > 0:
  shipping_cost = ship_cost_per_kg * weight_kg
Else:
  shipping_cost = 0
```

**Fees:**
```
referral_fee = target_price * referral_fee_pct / 100
fba_fee = (from SP-API or estimated)
total_fees = referral_fee + fba_fee + shipping_cost
```

**Net Margin:**
```
net_margin_low = target_price - landed_cost_high - total_fees
net_margin_high = target_price - landed_cost_low - total_fees
net_margin_pct_low = (net_margin_low / target_price) * 100
net_margin_pct_high = (net_margin_high / target_price) * 100
```

**Breakeven Price:**
```
breakeven_price_low = landed_cost_low + total_fees
breakeven_price_high = landed_cost_high + total_fees
```

### Output Display

**Results Section:**
1. **FBA Fee Info:**
   - Shows FBA fee amount
   - Displays "(est.)" if estimated
   - Shows loading state while fetching

2. **Landed Cost:**
   - Range: `$X.XX - $Y.YY`
   - Subtitle: "COGS + Shipping"

3. **Total Fees:**
   - Single value (same for low/high scenarios)
   - Subtitle: "Referral + FBA + Shipping"

4. **Net Margin %:**
   - Range: `X.X% - Y.Y%`
   - Minimum 0% (negative margins clamped)

5. **Breakeven Price:**
   - Range: `$X.XX - $Y.YY`
   - Price needed to cover all costs

### Real-Time Updates
- All calculations use `useMemo` for performance
- Updates instantly when any input changes
- No API calls needed for calculations (except FBA fee fetch)

### AI Integration
- AI system prompt explicitly directs users to Feasibility Calculator for margin questions
- AI never calculates margins itself
- AI can reference calculator outputs if available in context

---

## KEY ARCHITECTURAL DECISIONS

### 1. Data Immutability
- Analysis runs are never modified after creation
- Chat messages are append-only
- Original verdict is marked as "AUTHORITATIVE"
- Prevents silent data changes and maintains historical accuracy

### 2. Anti-Hallucination Design
- Chat operates on cached data only (no live API calls)
- System prompt enforces strict data citation rules
- All claims must cite specific fields
- Missing data must be explicitly stated

### 3. Profile Versioning
- Profile includes `updated_at` timestamp
- Version included in AI context
- AI knows when profile data was last updated
- Enables future features like "profile changed since analysis"

### 4. Graceful Degradation
- API routes handle missing database columns gracefully
- Falls back to core fields if new columns don't exist
- Enables zero-downtime migrations

### 5. Separation of Concerns
- Feasibility Calculator is pure client-side (no AI)
- Margin calculations separate from market analysis
- AI references calculator outputs, doesn't duplicate logic

---

## DATABASE SCHEMA SUMMARY

### Core Tables

**`seller_profiles`**
- Primary key: `id` (UUID, foreign key to auth.users)
- Fields: `stage`, `experience_months`, `monthly_revenue_range`, `sourcing_model`, `goals`, `risk_tolerance`, `margin_target`, `max_fee_pct`, `updated_at`

**`analysis_runs`**
- Primary key: `id` (UUID)
- Foreign keys: `user_id` → auth.users
- Fields: `input_type`, `input_value`, `ai_verdict`, `ai_confidence`, `seller_stage`, `seller_experience_months`, `seller_monthly_revenue_range`, `response` (JSON), `rainforest_data` (JSON), `created_at`

**`analysis_messages`**
- Primary key: `id` (UUID)
- Foreign keys: `analysis_run_id` → analysis_runs
- Fields: `role`, `content`, `created_at`

**`seller_memory`**
- Primary key: `user_id` (UUID, foreign key to auth.users)
- Fields: `memory` (JSON)

**`seller_memories`** (structured memory)
- Primary key: `id` (UUID)
- Foreign keys: `user_id` → auth.users
- Fields: `memory_type`, `key`, `value` (JSON), `confidence`, `source`, `created_at`

**`pending_memories`**
- Primary key: `id` (UUID)
- Foreign keys: `user_id` → auth.users
- Fields: `memory_candidate` (JSON), `reason`, `created_at`

**`fba_fee_cache`**
- Primary key: composite (asin, price)
- Fields: `fulfillment_fee`, `referral_fee`, `source`, `cached_at`

**`usage_counters`**
- Primary key: `user_id` (UUID, foreign key to auth.users)
- Fields: `analyze_count`, `reset_at`

---

## SECURITY CONSIDERATIONS

1. **Authentication**: All API routes verify Supabase auth token
2. **Authorization**: Users can only access their own analysis runs
3. **Row-Level Security**: Supabase RLS policies enforce user isolation
4. **Input Validation**: All user inputs validated before processing
5. **SQL Injection**: Parameterized queries via Supabase client
6. **XSS Prevention**: React escapes all user-generated content

---

This breakdown covers the complete application functionality from onboarding through all core features. The system is designed with data immutability, anti-hallucination safeguards, and user personalization at its core.

