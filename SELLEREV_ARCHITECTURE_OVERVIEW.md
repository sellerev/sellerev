# Sellerev – Current Architecture & Data Flow Overview

## 1. High-Level Product Overview

**What Sellerev Is**

Sellerev is an AI-powered market analysis platform designed specifically for Amazon FBA sellers. The platform helps sellers evaluate product opportunities by analyzing Amazon search results, estimating market demand, and providing contextual insights through an integrated AI assistant.

**Who It's For**

Sellerev serves Amazon FBA sellers at all stages—from those exploring their first product idea to experienced sellers evaluating new opportunities. The platform is designed for sellers who need reliable market intelligence without the complexity and cost of enterprise tools.

**Core Problem It Solves vs. Helium 10 / Jungle Scout**

Unlike Helium 10 and Jungle Scout, which focus primarily on data aggregation and keyword research, Sellerev combines market analysis with AI-powered interpretation. The key differentiator is that Sellerev explains *why* market conditions matter, not just *what* the numbers are. The platform provides:

- **Proprietary insights**: Identifies products that appear multiple times on Page 1 (algorithmic boosts) and explains what this means for competitive dynamics
- **Context-aware analysis**: AI assistant that references specific product cards and market data the user is viewing
- **Trust-focused design**: Explicitly distinguishes between observed data (from Amazon) and modeled estimates, building confidence through transparency
- **No OAuth dependency**: Works without requiring sellers to connect their Amazon seller accounts, making it accessible to sellers at any stage

---

## 2. Core User Flows

### Keyword Analyze Flow

When a user searches for a keyword (e.g., "wireless earbuds"), the following sequence occurs:

1. **User Input**: Seller enters a keyword in the search interface
2. **Market Data Fetching**: System queries Rainforest API to retrieve Amazon search results for that keyword
3. **Data Processing**: Raw search results are parsed, deduplicated, and normalized into a canonical product set
4. **Demand Estimation**: Total Page-1 market demand is estimated using aggregate signals (organic listing count, median price, median reviews, category patterns)
5. **Demand Allocation**: Total market demand is distributed across individual products using rank-based weighting (top positions receive proportionally more demand)
6. **Calibration**: Estimates are normalized into realistic bands that align with market expectations (similar to Helium 10 ranges)
7. **AI Analysis**: AI system generates a verdict (GO/CAUTION/NO_GO) with reasoning based on market signals and seller profile
8. **Response Assembly**: All data is packaged into a structured response including market snapshot, product cards, and AI decision
9. **UI Display**: Results are presented with Page-1 product cards, market aggregates, and AI insights

### Page 1 Market View

The Page-1 view shows:

- **Product Cards**: Each card displays one unique ASIN with its price, rating, review count, estimated monthly units, estimated monthly revenue, revenue share percentage, fulfillment type (FBA/FBM/AMZ), and sponsored status
- **Market Summary**: Aggregated metrics including total monthly units, total monthly revenue, average price, average rating, product count, and sponsored listing count
- **Rank Semantics**: Products are ranked using "organic rank" (position among organic listings only) and "page position" (actual position including sponsored listings). This ensures sponsored listings don't inflate organic ranking
- **Sponsored Visibility**: Sponsored listings are clearly marked but included in market totals and competitive analysis

### Product Card Interaction (Spellbook-Style AI Reference)

When a user clicks on a product card or asks a question about a specific product:

1. **Selection Context**: The selected product's data is passed to the AI assistant
2. **AI Grounding**: The AI can reference specific fields from that product card (ASIN, rank, price, reviews, revenue estimates, etc.)
3. **Comparative Analysis**: The AI can compare the selected product to other Page-1 listings using actual data
4. **Algorithm Boost Insights**: If a product appears multiple times on Page 1, the AI can explain this as an algorithmic boost signal (a Sellerev-only insight)
5. **Data Citation**: All AI claims must reference specific fields from the product data—no generic advice or invented numbers

The AI assistant operates in "Spellbook" mode, meaning it explains what the user is seeing on their screen rather than making independent decisions. It never invents data and always cites its sources.

---

## 3. Data Sources (Critical Section)

### Rainforest API

**What It Provides**

Rainforest API is the primary data source for Amazon search results. It provides:

- **Search Results**: Complete Page-1 search results for any keyword, including both organic and sponsored listings
- **Product Data**: ASIN, title, price, rating, review count, product images
- **Best Seller Rank (BSR)**: Main category BSR for products (used internally for estimation, not displayed on keyword Page-1 cards)
- **Fulfillment Indicators**: Prime eligibility flag (used to infer FBA vs FBM)
- **Sponsored Status**: Clear indication of whether a listing is sponsored or organic
- **Brand Information**: Brand name when available
- **Seller Information**: Seller name (used to detect Amazon Retail listings)

**What It Does NOT Provide**

- True competitor sales data (Amazon does not share this)
- Historical sales trends
- PPC cost data
- Conversion rates
- "Bought in past month" signals
- Real-time inventory levels
- Seller account performance metrics

### Amazon SP-API (Current + Planned Usage)

**What Data Is Accessible Without OAuth**

SP-API provides certain public data without requiring seller account OAuth:

- **FBA Fee Calculations**: Can fetch actual FBA fees for specific products using ASIN and marketplace
- **Product Catalog Data**: Public product information (similar to what Rainforest provides)
- **Category Information**: Product categorization data

**Why It's Used for ASIN-Level Analysis, Not Keyword Market Sizing**

SP-API is primarily used for:
- Fee estimation when a representative ASIN is selected
- ASIN-specific analysis (when a seller wants to analyze a specific product)
- Margin calculations (combining fee data with price data)

It is NOT used for keyword market sizing because:
- SP-API does not provide search result data (that comes from Rainforest)
- SP-API does not provide competitor sales data
- Market sizing requires aggregate analysis of multiple products, which SP-API doesn't support

### What Data Is Explicitly NOT Available from Amazon

**True Competitor Sales**

Amazon does not share actual sales data for competitor products. This is a fundamental limitation that affects all market analysis tools, including Helium 10 and Jungle Scout. Sellerev addresses this by:

- Using BSR as a proxy for sales velocity (lower BSR = higher sales)
- Applying demand floors based on review counts and market position
- Normalizing estimates to align with market expectations
- Being transparent that all sales numbers are modeled, not reported

**Other Missing Signals**

- "Bought in past month" indicators (Amazon does not expose this)
- Real-time inventory levels
- Historical sales velocity (without seller account access)
- PPC spend data for competitors
- Conversion rate data
- Return rate data

---

## 4. Canonicalization & Deduplication Logic

### How Page 1 Products Are Collected

When Amazon search results are retrieved via Rainforest API, the raw response can contain:

- Multiple result arrays (search_results, organic_results, ads, results)
- Duplicate ASINs appearing in different positions
- Mixed organic and sponsored listings

Sellerev collects ALL listings from ALL possible locations in the Rainforest response to ensure complete Page-1 coverage.

### How ASINs Are Deduplicated

**The Problem**: Amazon search results can show the same ASIN multiple times (e.g., in organic position 3 and sponsored position 8). This creates confusion and inflated counts.

**The Solution**: Before any estimation or ranking logic, Sellerev deduplicates ASINs using strict rules:

1. **Group by ASIN**: All listings are grouped by their ASIN
2. **Best Rank Selection**: If an ASIN appears multiple times, the instance with the BEST (lowest) rank number is kept
3. **Organic Priority**: If one instance is organic and another is sponsored, the organic instance is preferred (even if it has a higher rank number)
4. **Discard Duplicates**: All other appearances of the same ASIN are discarded

**Result**: Each ASIN appears exactly once in the canonical product set, ensuring consistent revenue estimates, rankings, and AI context.

### How Organic vs Sponsored Listings Are Identified

Rainforest API provides an explicit `is_sponsored` flag for each listing. This flag is:

- Preserved throughout the pipeline
- Used to separate organic and sponsored listings for ranking
- Displayed on product cards for user clarity
- Used in market aggregation (sponsored listings are included in totals)

### How Rank Semantics Work

Sellerev uses two distinct rank concepts to match Helium 10 expectations:

**Organic Rank** (`organic_rank`):
- Position among organic listings only (1, 2, 3...)
- Sponsored listings have `organic_rank = null`
- Used for estimation logic and competitive comparisons
- Ensures sponsored listings don't inflate organic ranking

**Page Position** (`page_position`):
- Actual Page-1 position including sponsored listings (1, 2, 3...)
- All listings have a page_position
- Reflects the true order products appear on Amazon's search results page

**Why This Matters**: A product might be Page Position 5 (including sponsored) but Organic Rank 3 (excluding sponsored). This distinction helps sellers understand true organic competition vs. overall visibility.

---

## 5. Revenue & Sales Estimation Model (Important)

### The Fundamental Truth

**All revenue and sales numbers are modeled, not reported by Amazon.** Amazon does not share competitor sales data with any third-party tool. This is true for Helium 10, Jungle Scout, and Sellerev.

### What Inputs Are Used Today

Sellerev's estimation model uses the following inputs (all from Rainforest API or derived from it):

1. **Best Seller Rank (BSR)**: Lower BSR indicates higher sales velocity. Used internally for estimation but not displayed on keyword Page-1 cards.
2. **Organic Rank**: Position among organic listings (rank 1 gets more demand than rank 10)
3. **Price**: Product price (used to convert units to revenue)
4. **Review Count**: More reviews suggest more established products with higher sales
5. **Rating**: Higher ratings suggest better conversion potential
6. **Category Patterns**: Different categories have different demand characteristics
7. **Sponsored Status**: Sponsored listings receive different demand allocation (capped at 15% of total)
8. **Fulfillment Type**: FBA products may have different demand characteristics than FBM

### How Sellerev Normalizes Results

Sellerev uses a "total market first, then allocate" approach (similar to Helium 10):

1. **Estimate Total Page-1 Demand**: Using aggregate signals (organic listing count, median price, median reviews, category multipliers), the system estimates total monthly units for the entire Page-1 market
2. **Apply Calibration**: Total demand is normalized into realistic bands (low competition: 2k-6k units, medium: 6k-15k units, high: 15k-35k units)
3. **Allocate by Rank**: Total demand is distributed across products using an exponential decay curve based on organic rank (rank 1 gets highest weight, rank 10+ gets much lower)
4. **Apply Demand Floors**: Conservative minimums are applied based on review counts, rank, and fulfillment type to prevent unrealistically low estimates
5. **Normalize Distribution**: Position-based multipliers ensure top 3 listings dominate revenue (matching Helium 10 behavior)
6. **Cap Sponsored**: Sponsored listings are capped at 15% of total demand and never outrank organic in allocation

### Why Exact Matching Is Impossible

**Different Data Sources**: Helium 10 may use different data sources, estimation formulas, or update frequencies than Sellerev. Even if both tools used identical logic, slight differences in when data was collected could produce different numbers.

**Different Calibration**: Each tool applies its own calibration and normalization. Sellerev's goal is directional accuracy (trends matter more than exact values), not pixel-perfect matching.

**Market Volatility**: Amazon search results change frequently. A product ranked #3 today might be #7 tomorrow, affecting all downstream estimates.

### Trust Positioning

Sellerev positions its numbers as:

- **Directionally accurate**: Trends and relative comparisons are reliable
- **Stable week-to-week**: Calibration ensures consistency over time
- **Transparent**: Users understand these are modeled estimates, not Amazon-reported data
- **Confidence-banded**: Each analysis includes a confidence level (Low/Medium/High) with an explanation

The platform never claims these numbers are "exact" or "reported by Amazon." Instead, it focuses on helping sellers understand market dynamics and make informed decisions.

---

## 6. Market Snapshot Aggregation

### How Total Market Revenue and Units Are Calculated

**Page-1 Only Logic**:

1. **Total Units**: Sum of all `estimated_monthly_units` for products on Page 1 (after deduplication and allocation)
2. **Total Revenue**: Sum of all `estimated_monthly_revenue` for products on Page 1
3. **Product Count**: Number of unique ASINs on Page 1 (organic + sponsored, after deduplication)

**Key Point**: These totals represent the entire Page-1 market, not just organic listings. Sponsored listings are included because they compete for the same customer attention.

### Why Page 1 + Sponsored Is the Chosen Scope

**Realistic Competition View**: When a seller searches for a keyword, they see both organic and sponsored results. A complete market analysis must account for both.

**Sponsored Impact**: Sponsored listings can capture significant market share (up to 15% in Sellerev's model). Ignoring them would understate competitive pressure.

**User Expectation**: Sellers expect to see the same products they see on Amazon's search results page. Including sponsored listings matches this expectation.

**Helium 10 Alignment**: Helium 10 also includes sponsored listings in market analysis, so this scope matches industry expectations.

---

## 7. UI Presentation Layer

### How Product Cards Are Populated

Each product card displays:

- **ASIN**: Unique product identifier
- **Title**: Product title from Amazon
- **Image**: Product image URL
- **Price**: Current price (from Rainforest API)
- **Rating**: Average star rating (from Rainforest API)
- **Review Count**: Number of reviews (from Rainforest API, mapped from `review_count` or `reviews` field)
- **Estimated Monthly Units**: Modeled estimate (from allocation logic)
- **Estimated Monthly Revenue**: Modeled estimate (units × price)
- **Revenue Share %**: Percentage of total Page-1 revenue this product represents
- **Fulfillment**: FBA, FBM, or AMZ (inferred from Prime eligibility and seller name)
- **Brand**: Brand name when available
- **Sponsored Badge**: Visual indicator if the listing is sponsored
- **Organic Rank**: Position among organic listings (null for sponsored)
- **Page Position**: Actual position on Page 1 (including sponsored)

**Note**: BSR is intentionally NOT displayed on keyword Page-1 cards (set to null) to avoid confusion. BSR is still used internally for estimation.

### What Fields Are Shown to Users

**Market Summary Section**:
- Total monthly units (modeled)
- Total monthly revenue (modeled)
- Average price (observed from Rainforest)
- Average rating (observed from Rainforest)
- Product count (unique ASINs on Page 1)
- Sponsored count (number of sponsored listings)

**Product Cards**:
- All fields listed above, sorted by revenue (default) or other user-selected criteria

**AI Insights**:
- Verdict (GO/CAUTION/NO_GO) with confidence score
- Executive summary with numeric citations
- Risk breakdown (competition, pricing, differentiation, operations)
- Recommended actions
- Assumptions and limitations

### How Aggregates Roll Up into Market Summary

All aggregates are calculated from the canonical product set (after deduplication):

- **Average Price**: Mean of all product prices on Page 1
- **Average Rating**: Mean of all product ratings on Page 1
- **Average BSR**: Mean of all BSRs (used internally, not displayed)
- **Total Units**: Sum of all `estimated_monthly_units`
- **Total Revenue**: Sum of all `estimated_monthly_revenue`
- **Product Count**: `new Set(products.map(p => p.asin)).size` (unique ASIN count)

### How AI References Specific Product Cards

When a user clicks a product card or asks about a specific product:

1. **Selection Context**: The selected product's full data object is passed to the AI assistant
2. **Field Access**: The AI can reference any field from that product (ASIN, rank, price, reviews, revenue, etc.)
3. **Comparative Analysis**: The AI can compare the selected product to other Page-1 listings using actual data
4. **Data Citation**: All AI claims must cite specific fields (e.g., "This product has 2,400 reviews (from review_count field)")
5. **Algorithm Boost Insights**: If `is_algorithm_boosted === true`, the AI can explain why the product appears multiple times on Page 1

**Critical Rule**: The AI can ONLY make claims supported by fields in the product data. It cannot invent numbers or make unqualified statements.

---

## 8. Current Limitations (Honest but Strategic)

### Missing Signals

**"Bought in Past Month"**: Amazon does not expose this data. Sellerev cannot show which products are trending or recently popular beyond what review counts and BSR suggest.

**Historical Sales Velocity**: Without seller account access, Sellerev cannot show historical sales trends for competitor products. The platform focuses on current market state.

**PPC Cost Data**: Sellerev cannot show actual PPC costs for competitors. Instead, it provides PPC indicators (sponsored density, review barriers) that suggest competitive pressure.

**Conversion Rates**: Amazon does not share conversion rate data. Sellerev uses review counts and ratings as proxies for conversion potential.

### Why Some Amazon UI Elements Cannot Be Replicated

**Amazon's Internal Metrics**: Amazon uses proprietary algorithms and internal data that are not accessible via public APIs. Tools like "Amazon's Choice" badges, "Best Seller" labels, and "Frequently Bought Together" are Amazon-only signals.

**Real-Time Inventory**: Amazon shows inventory levels to logged-in users, but this data is not available via Rainforest API or SP-API.

**Personalized Results**: Amazon's search results are personalized for each user. Sellerev shows a "standard" view based on Rainforest API's default search results.

### What Sellerev Intentionally Avoids Showing

**Exact Sales Numbers**: Sellerev never claims to show "exact" sales because Amazon doesn't provide this. All numbers are clearly labeled as estimates.

**Guaranteed Rankings**: Sellerev does not promise that a product will rank at a specific position. Rankings are dynamic and depend on many factors beyond what can be observed.

**Profitability Calculations Without User Input**: Sellerev provides a Feasibility Calculator where users input their own COGS and assumptions. The AI assistant does not calculate margins without this user input.

**Generic Advice**: The AI assistant is prohibited from giving generic Amazon FBA advice not grounded in Page-1 data. All recommendations must reference specific observations from the market analysis.

---

## 9. Strategic Direction (Short)

### Why Sellerev Is Building Toward "Helium 10 + Spellbook"

**Helium 10's Strength**: Comprehensive data aggregation and keyword research tools that sellers trust.

**Spellbook's Innovation**: AI that explains data in context, helping users understand *why* numbers matter, not just *what* they are.

**Sellerev's Vision**: Combine reliable market data (like Helium 10) with intelligent interpretation (like Spellbook) to create a platform that helps sellers make better decisions faster.

### Where Proprietary Intelligence Will Come From Over Time

**Algorithm Boost Detection**: Already implemented. Sellerev identifies products that appear multiple times on Page 1 and explains what this means for competitive dynamics—an insight Helium 10 does not provide.

**Historical Blending**: As Sellerev collects more historical data, estimates will improve by blending current observations with past patterns.

**Category-Specific Calibration**: Over time, Sellerev will develop category-specific calibration models that improve accuracy for specific product types.

**Seller Memory Integration**: The platform will learn from each seller's past analyses and preferences, providing increasingly personalized insights.

### Why the Architecture Is Designed for Scale and Learning

**Modular Design**: Each component (data fetching, canonicalization, estimation, calibration, AI) is separated, allowing independent improvement without breaking the system.

**Data Contract**: Strict schemas ensure consistency as new features are added. The system can evolve without breaking existing functionality.

**Calibration Layer**: The calibration system allows Sellerev to adjust estimates over time as more data becomes available, without changing core logic.

**AI Grounding**: The AI assistant is designed to cite specific data fields, making it easy to verify claims and improve accuracy over time.

**No OAuth Dependency**: By not requiring seller account connections, Sellerev can scale to any seller without permission barriers.

---

## Executive Summary

- **Sellerev combines market analysis with AI interpretation** to help Amazon FBA sellers evaluate product opportunities, positioning itself as "Helium 10 + Spellbook" for the Amazon seller market.

- **All revenue and sales numbers are modeled estimates**, not Amazon-reported data. The platform is transparent about this limitation and focuses on directional accuracy and trend analysis rather than exact matching.

- **Data flows from Rainforest API** (search results, product data) through a canonicalization layer (ASIN deduplication, rank assignment) to an estimation model (total market demand → rank-based allocation) to calibrated outputs (normalized to realistic bands).

- **The AI assistant operates in "Spellbook" mode**, explaining what users see on their screen and citing specific data fields. It never invents data and always distinguishes between observed data and modeled estimates.

- **Page-1 scope includes both organic and sponsored listings** to provide a complete competitive view. Each ASIN appears exactly once after deduplication, ensuring consistent estimates and AI context.

- **Proprietary insights include algorithm boost detection** (identifying products that appear multiple times on Page 1) and contextual explanations that Helium 10 does not provide.

- **The architecture is designed for learning and scale**, with modular components, strict data contracts, and a calibration layer that improves over time as more historical data becomes available.


