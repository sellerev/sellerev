# Copilot Escalation Policy (Frozen)

**Version:** 1.0  
**Status:** FROZEN — This policy defines exact rules for when Copilot can escalate to per-product API calls  
**Last Updated:** 2024

---

## Executive Summary

This document defines **exact decision rules** for when Copilot is allowed to escalate to per-product Rainforest API calls (`type=product`) versus when it must answer using Page-1 data only.

**Core Principle:** Copilot must **prefer estimates and reasoning over verification**. "Better accuracy" alone is **NOT** a valid reason to escalate. Escalation is only permitted when the question **explicitly requires data that cannot be derived from Page-1 fields, estimates, rankings, or aggregates**.

---

## 1. Escalation Rules (Non-Negotiable)

### 1.1 Strict Escalation Criteria

Copilot may **ONLY** escalate to `type=product` API calls if **ALL** of the following are true:

1. **The question explicitly asks for missing or unverifiable data:**
   - Data is not present in Page-1 product cards
   - Data cannot be inferred from available fields
   - Data cannot be estimated using models or heuristics

2. **The answer cannot be derived from:**
   - Page-1 product fields (ASIN, price, rating, reviews, rank, etc.)
   - Market snapshot aggregates (avg price, total units/revenue, etc.)
   - Estimated fields (estimated_monthly_units, estimated_monthly_revenue)
   - Rankings and position data (organic_rank, page_position)
   - Algorithm boost signals (is_algorithm_boosted, page_one_appearances)
   - Market structure metrics (price compression, review barriers, brand moat)

3. **The question requires product-level detail beyond Page-1 scope:**
   - Product specifications (dimensions, weight, materials, features)
   - Product variations/options (color, size, style options)
   - Detailed product descriptions
   - Historical sales trends for specific products
   - Seller account information not visible on Page-1

### 1.2 Escalation Constraints

- **Maximum ASINs per escalation:** 2 ASINs
- **API call type:** `type=product` only (Rainforest API)
- **Credit counting:** All escalation calls must be counted as paid credits
- **User notification:** Must explicitly communicate to user ("Looking up listing details...")
- **Caching:** All escalation results must be cached to avoid repeat calls

### 1.3 Invalid Escalation Reasons

**Copilot MUST NOT escalate for:**
- ❌ "Better accuracy" of estimates (estimates are sufficient)
- ❌ "Verification" of existing Page-1 data (use existing data)
- ❌ "More detail" when estimates/aggregates answer the question
- ❌ "Confidence improvement" (use qualitative reasoning instead)
- ❌ "Completeness" when partial data is sufficient to answer
- ❌ Questions that can be answered with estimates, rankings, or aggregates

---

## 2. Questions That Can Be Answered WITHOUT API Calls

### 2.1 Market Structure Questions

**All of these can be answered using Page-1 data + market snapshot:**

| Question Type | Page-1 Data Used | Reasoning Method |
|--------------|------------------|-------------------|
| "How competitive is this market?" | Review barrier, price compression, brand moat, CPI score | Aggregate analysis from market_structure |
| "What's the review barrier?" | `review_barrier.median_reviews`, `review_barrier.top_5_avg_reviews` | Direct from market_structure |
| "How tight is price compression?" | `price_band.min`, `price_band.max`, `price_band.tightness` | Direct from market_structure |
| "What's the brand dominance?" | `brand_moat.moat_strength`, `brand_moat.top_brand_revenue_share_pct` | Direct from brand_moat analysis |
| "How many brands are on Page 1?" | `brand_moat.total_brands_count` | Direct from brand_moat |
| "What's the fulfillment mix?" | `fulfillment_mix.fba_pct`, `fulfillment_mix.fbm_pct`, `fulfillment_mix.amazon_pct` | Direct from market_structure |
| "What's the total market size?" | `total_monthly_units_est`, `total_monthly_revenue_est` | Direct from summary (estimated) |
| "What's the average price?" | `avg_price` | Direct from summary |
| "How many sponsored listings?" | `sponsored_count` | Direct from summary |

**Answer Method:** Reference specific fields from `market_structure`, `brand_moat`, or `summary` objects. Use qualitative descriptions if numbers unavailable.

### 2.2 Product Comparison Questions

**All of these can be answered using Page-1 product cards:**

| Question Type | Page-1 Data Used | Reasoning Method |
|--------------|------------------|-------------------|
| "Which product has more reviews?" | `review_count` for each product | Direct comparison |
| "Which product is ranked higher?" | `organic_rank`, `page_position` | Direct comparison |
| "Which product has higher revenue?" | `estimated_monthly_revenue` | Direct comparison (estimated) |
| "Which product is priced better?" | `price` for each product | Direct comparison |
| "Why is product X ranking despite fewer reviews?" | `organic_rank`, `review_count`, `is_algorithm_boosted`, `page_one_appearances` | Algorithm boost analysis |
| "Compare product A vs product B" | All product card fields for both products | Multi-field comparison |

**Answer Method:** Reference specific product cards by ASIN or rank. Use `estimated_monthly_revenue` and `estimated_monthly_units` (clearly labeled as estimates).

### 2.3 Strategic Questions

**All of these can be answered using Page-1 data + reasoning:**

| Question Type | Page-1 Data Used | Reasoning Method |
|--------------|------------------|-------------------|
| "Is this market winnable?" | Review barrier, price compression, brand moat, seller profile | Structural analysis + seller constraints |
| "What would kill a new launch?" | Review barrier, price compression, revenue concentration, CPI | Risk analysis from market structure |
| "How can I differentiate?" | Price distribution, fulfillment mix, review counts, algorithm boosts | Gap analysis from Page-1 listings |
| "What's my entry strategy?" | Market structure, seller profile, review barriers | Strategic reasoning from aggregates |
| "Should I invest here?" | Market structure, seller capital constraints, review barriers | Capital allocation reasoning |
| "What would change your mind?" | Current market structure metrics | Conditional reasoning from existing data |

**Answer Method:** Use market structure metrics + seller profile constraints. Frame as capital/time/structural requirements, not generic advice.

### 2.4 Estimation Questions

**All of these can be answered using estimated fields:**

| Question Type | Page-1 Data Used | Reasoning Method |
|--------------|------------------|-------------------|
| "How much revenue does product X make?" | `estimated_monthly_revenue` for product | Direct from product card (clearly labeled as estimate) |
| "How many units does product X sell?" | `estimated_monthly_units` for product | Direct from product card (clearly labeled as estimate) |
| "What's the revenue share of product X?" | `revenue_share_pct` for product | Direct from product card |
| "How accurate are these estimates?" | `estimation_confidence_score`, `estimation_notes` | Reference estimation metadata |
| "Why are estimates different from Helium 10?" | Estimation model explanation | Reference `estimation_model` and calibration notes |

**Answer Method:** Always say "estimated" or "modeled" when referencing these fields. Explain that estimates are directional, not exact.

### 2.5 Algorithm Boost Questions

**All of these can be answered using algorithm boost signals:**

| Question Type | Page-1 Data Used | Reasoning Method |
|--------------|------------------|-------------------|
| "Why does product X appear multiple times?" | `page_one_appearances`, `is_algorithm_boosted` | Algorithm boost analysis |
| "Which products are algorithm-boosted?" | `is_algorithm_boosted` for all products | Filter products where `is_algorithm_boosted === true` |
| "What does algorithm boost mean?" | `page_one_appearances`, `is_algorithm_boosted` | Explain Sellerev-only insight |

**Answer Method:** Reference `is_algorithm_boosted` and `page_one_appearances` fields. Explain as Amazon's algorithm amplifying visibility.

---

## 3. Questions That REQUIRE Escalation

### 3.1 Product Specification Questions

**These require `type=product` API calls because specifications are not in Page-1 data:**

| Question Type | Minimal Data Needed | ASINs Required | Call Type | Credits |
|---------------|---------------------|---------------|----------|---------|
| "What are the dimensions of product X?" | Product dimensions, weight | 1 ASIN | `type=product` | 1 |
| "What materials is product X made from?" | Product specifications, description | 1 ASIN | `type=product` | 1 |
| "What features does product X have?" | Product specifications, bullet points | 1 ASIN | `type=product` | 1 |
| "What's the weight of product X?" | Product weight | 1 ASIN | `type=product` | 1 |
| "What color options does product X have?" | Product variations (colors, sizes) | 1 ASIN | `type=product` | 1 |
| "What size options does product X have?" | Product variations (sizes, styles) | 1 ASIN | `type=product` | 1 |
| "Compare dimensions of product A vs product B" | Product dimensions for both | 2 ASINs | `type=product` (2 calls) | 2 |

**Escalation Rule:** Only escalate if question explicitly asks for specifications not visible on Page-1. If question can be answered with "I don't have that detail, but here's what I can see from Page-1...", do NOT escalate.

### 3.2 Historical Trend Questions

**These require `type=product` API calls because historical data is not in Page-1:**

| Question Type | Minimal Data Needed | ASINs Required | Call Type | Credits |
|---------------|---------------------|---------------|----------|---------|
| "How has product X's price changed over time?" | Historical price data | 1 ASIN | `type=product` | 1 |
| "What was product X's BSR 3 months ago?" | Historical BSR data | 1 ASIN | `type=product` | 1 |
| "Has product X's ranking improved?" | Historical ranking data | 1 ASIN | `type=product` | 1 |

**Escalation Rule:** Only escalate if question explicitly asks for historical trends. If question can be answered with current Page-1 data ("Currently, product X is ranked #3..."), do NOT escalate.

**Note:** Rainforest API may not provide historical data. In this case, Copilot should explain that historical data is not available, not escalate further.

### 3.3 Detailed Product Description Questions

**These require `type=product` API calls because full descriptions are not in Page-1:**

| Question Type | Minimal Data Needed | ASINs Required | Call Type | Credits |
|---------------|---------------------|---------------|----------|---------|
| "What's the full product description of X?" | Full product description, bullet points | 1 ASIN | `type=product` | 1 |
| "What are the key selling points of product X?" | Product bullet points, features | 1 ASIN | `type=product` | 1 |
| "What does the product description say about X?" | Full product description | 1 ASIN | `type=product` | 1 |

**Escalation Rule:** Only escalate if question explicitly asks for full description. If `title` field is sufficient to answer ("The title suggests..."), do NOT escalate.

### 3.4 Seller Account Questions

**These require `type=product` API calls because seller info is not in Page-1:**

| Question Type | Minimal Data Needed | ASINs Required | Call Type | Credits |
|---------------|---------------------|---------------|----------|---------|
| "Who is the seller of product X?" | Seller name, seller information | 1 ASIN | `type=product` | 1 |
| "What's the seller's rating for product X?" | Seller rating, seller metrics | 1 ASIN | `type=product` | 1 |
| "Is product X sold by Amazon or third-party?" | Seller information | 1 ASIN | `type=product` | 1 |

**Escalation Rule:** Only escalate if question explicitly asks for seller details. If `fulfillment` field is sufficient ("Product X is fulfilled by Amazon..."), do NOT escalate.

**Note:** `fulfillment` field (FBA/FBM/AMZ) is available on Page-1. Only escalate if question asks for specific seller name or seller account details.

### 3.5 Product Variation Questions

**These require `type=product` API calls because variations are not in Page-1:**

| Question Type | Minimal Data Needed | ASINs Required | Call Type | Credits |
|---------------|---------------------|---------------|----------|---------|
| "What variations does product X have?" | Product variations (colors, sizes, styles) | 1 ASIN | `type=product` | 1 |
| "Compare variations of product A vs product B" | Product variations for both | 2 ASINs | `type=product` (2 calls) | 2 |
| "What's the parent ASIN of product X?" | Parent ASIN, variation data | 1 ASIN | `type=product` | 1 |

**Escalation Rule:** Only escalate if question explicitly asks for variation details. If question can be answered with "Product X appears to be a single listing...", do NOT escalate.

---

## 4. Decision Table

### 4.1 Complete Escalation Decision Matrix

| Question Type | Example Questions | Can Answer from Page-1? | Requires API Call? | Call Type | Credits Required | Reasoning |
|---------------|-------------------|------------------------|-------------------|-----------|------------------|-----------|
| **Market Structure** | "How competitive is this market?" | ✅ Yes | ❌ No | N/A | 0 | Use `market_structure`, `brand_moat`, `summary` |
| **Market Structure** | "What's the review barrier?" | ✅ Yes | ❌ No | N/A | 0 | Use `review_barrier.median_reviews` |
| **Market Structure** | "What's the price compression?" | ✅ Yes | ❌ No | N/A | 0 | Use `price_band.tightness` |
| **Market Structure** | "How many brands are on Page 1?" | ✅ Yes | ❌ No | N/A | 0 | Use `brand_moat.total_brands_count` |
| **Product Comparison** | "Which product has more reviews?" | ✅ Yes | ❌ No | N/A | 0 | Compare `review_count` fields |
| **Product Comparison** | "Which product is ranked higher?" | ✅ Yes | ❌ No | N/A | 0 | Compare `organic_rank` or `page_position` |
| **Product Comparison** | "Compare product A vs product B" | ✅ Yes | ❌ No | N/A | 0 | Compare all product card fields |
| **Revenue/Units** | "How much revenue does X make?" | ✅ Yes | ❌ No | N/A | 0 | Use `estimated_monthly_revenue` (clearly labeled as estimate) |
| **Revenue/Units** | "How many units does X sell?" | ✅ Yes | ❌ No | N/A | 0 | Use `estimated_monthly_units` (clearly labeled as estimate) |
| **Revenue/Units** | "How accurate are these estimates?" | ✅ Yes | ❌ No | N/A | 0 | Use `estimation_confidence_score`, `estimation_notes` |
| **Algorithm Boost** | "Why does X appear multiple times?" | ✅ Yes | ❌ No | N/A | 0 | Use `is_algorithm_boosted`, `page_one_appearances` |
| **Strategic** | "Is this market winnable?" | ✅ Yes | ❌ No | N/A | 0 | Use market structure + seller profile |
| **Strategic** | "What would kill a new launch?" | ✅ Yes | ❌ No | N/A | 0 | Use market structure risk analysis |
| **Strategic** | "How can I differentiate?" | ✅ Yes | ❌ No | N/A | 0 | Use price distribution, fulfillment mix gaps |
| **Product Specs** | "What are the dimensions of X?" | ❌ No | ✅ Yes | `type=product` | 1 | Specifications not in Page-1 |
| **Product Specs** | "What materials is X made from?" | ❌ No | ✅ Yes | `type=product` | 1 | Specifications not in Page-1 |
| **Product Specs** | "What features does X have?" | ❌ No | ✅ Yes | `type=product` | 1 | Specifications not in Page-1 |
| **Product Specs** | "Compare dimensions of A vs B" | ❌ No | ✅ Yes | `type=product` | 2 | 2 ASINs required |
| **Product Variations** | "What color options does X have?" | ❌ No | ✅ Yes | `type=product` | 1 | Variations not in Page-1 |
| **Product Variations** | "What size options does X have?" | ❌ No | ✅ Yes | `type=product` | 1 | Variations not in Page-1 |
| **Product Variations** | "Compare variations of A vs B" | ❌ No | ✅ Yes | `type=product` | 2 | 2 ASINs required |
| **Historical Trends** | "How has X's price changed?" | ❌ No | ✅ Yes | `type=product` | 1 | Historical data not in Page-1 |
| **Historical Trends** | "What was X's BSR 3 months ago?" | ❌ No | ✅ Yes | `type=product` | 1 | Historical data not in Page-1 |
| **Product Description** | "What's the full description of X?" | ❌ No | ✅ Yes | `type=product` | 1 | Full description not in Page-1 |
| **Seller Account** | "Who is the seller of X?" | ❌ No | ✅ Yes | `type=product` | 1 | Seller name not in Page-1 |
| **Seller Account** | "What's the seller's rating?" | ❌ No | ✅ Yes | `type=product` | 1 | Seller rating not in Page-1 |

### 4.2 Edge Cases

| Scenario | Decision | Reasoning |
|----------|----------|-----------|
| Question asks "What's the exact revenue of X?" | ❌ Do NOT escalate | Use `estimated_monthly_revenue` and explain it's an estimate. "Exact" is not available from Amazon. |
| Question asks "Verify the price of X" | ❌ Do NOT escalate | Use existing `price` field from Page-1. No need to verify. |
| Question asks "Get more details about X" (vague) | ❌ Do NOT escalate | Ask clarifying question: "What specific detail do you need?" |
| Question asks "Is X profitable?" | ❌ Do NOT escalate | Direct to Feasibility Calculator. Cannot determine profitability without COGS. |
| Question asks "What's the conversion rate of X?" | ❌ Do NOT escalate | Conversion rate not available from Amazon. Explain limitation. |
| Question asks "What's the PPC cost for X?" | ❌ Do NOT escalate | PPC cost not available from Amazon. Explain limitation. |
| Question asks "What's the return rate of X?" | ❌ Do NOT escalate | Return rate not available from Amazon. Explain limitation. |
| Question asks "What's the inventory level of X?" | ❌ Do NOT escalate | Inventory not available from Amazon. Explain limitation. |
| Question asks "What's the sales velocity of X?" | ✅ Use estimate | Use `estimated_monthly_units` (clearly labeled as estimate). Do NOT escalate. |
| Question asks "Compare A vs B in detail" | ⚠️ Conditional | If question can be answered with Page-1 fields (price, reviews, rank, revenue), do NOT escalate. Only escalate if question explicitly asks for specs/variations. |

---

## 5. Escalation Workflow

### 5.1 Pre-Escalation Check

Before escalating, Copilot MUST:

1. **Check if question can be answered with Page-1 data:**
   - Review all available product card fields
   - Review all market snapshot aggregates
   - Review all estimated fields
   - Review all market structure metrics

2. **Check if question can be answered with reasoning:**
   - Can qualitative analysis answer the question?
   - Can estimates (clearly labeled) answer the question?
   - Can aggregate analysis answer the question?

3. **Check if question explicitly requires missing data:**
   - Does the question ask for data not in Page-1?
   - Is the data available from `type=product` API?
   - Is the data actually needed to answer the question?

### 5.2 Escalation Process

If escalation is required:

1. **User Notification:**
   - Explicitly communicate: "Looking up listing details for [ASIN(s)]..."
   - Show which ASIN(s) are being looked up
   - Explain why escalation is needed

2. **API Call:**
   - Make `type=product` call(s) for specified ASIN(s)
   - Maximum 2 ASINs per escalation
   - Batch calls if multiple ASINs (parallel execution)

3. **Credit Counting:**
   - Count each `type=product` call as 1 paid credit
   - Log credits used for this escalation

4. **Caching:**
   - Cache all escalation results
   - Check cache before making new API calls
   - Use cached data if available (avoid repeat calls)

5. **Response:**
   - Answer question using escalated data
   - Clearly distinguish escalated data from Page-1 estimates
   - Reference source: "From product details: [data]"

### 5.3 Post-Escalation

After escalation:

1. **Cache Results:**
   - Store escalated data in cache
   - Associate with ASIN(s) for future use

2. **Log Escalation:**
   - Log which question triggered escalation
   - Log which ASIN(s) were looked up
   - Log credits used

3. **Update Context:**
   - Add escalated data to conversation context
   - Make available for follow-up questions

---

## 6. Examples

### 6.1 Valid Escalation Examples

**Example 1: Product Specifications**
- **Question:** "What are the dimensions of product B0973DGD8P?"
- **Decision:** ✅ Escalate
- **Reasoning:** Dimensions are not in Page-1 data. Question explicitly asks for specifications.
- **Action:** Make `type=product` call for ASIN B0973DGD8P (1 credit)
- **Response:** "Looking up listing details for B0973DGD8P... [After API call] The product dimensions are 8.5 x 6.2 x 2.1 inches."

**Example 2: Product Variations**
- **Question:** "What color options does product B08XYZ123 have?"
- **Decision:** ✅ Escalate
- **Reasoning:** Color variations are not in Page-1 data. Question explicitly asks for variations.
- **Action:** Make `type=product` call for ASIN B08XYZ123 (1 credit)
- **Response:** "Looking up listing details for B08XYZ123... [After API call] This product is available in Black, White, and Gray."

**Example 3: Two-Product Comparison**
- **Question:** "Compare the dimensions of product A vs product B"
- **Decision:** ✅ Escalate
- **Reasoning:** Dimensions are not in Page-1 data. Question explicitly asks for specifications for 2 products.
- **Action:** Make 2 `type=product` calls (2 credits)
- **Response:** "Looking up listing details for both products... [After API calls] Product A: 8.5 x 6.2 x 2.1 inches. Product B: 10.0 x 7.5 x 3.0 inches."

### 6.2 Invalid Escalation Examples

**Example 1: Revenue Question**
- **Question:** "How much revenue does product B0973DGD8P make?"
- **Decision:** ❌ Do NOT escalate
- **Reasoning:** `estimated_monthly_revenue` is available on Page-1. Question can be answered with estimate.
- **Action:** Use `estimated_monthly_revenue` from product card
- **Response:** "Product B0973DGD8P has an estimated monthly revenue of $12,450 (this is a modeled estimate, not exact sales data)."

**Example 2: Comparison Question**
- **Question:** "Compare product A vs product B"
- **Decision:** ❌ Do NOT escalate (unless question explicitly asks for specs)
- **Reasoning:** All comparison fields (price, reviews, rank, revenue) are available on Page-1.
- **Action:** Compare product card fields
- **Response:** "Product A (rank #3) has 2,400 reviews and estimated revenue of $15,000/month. Product B (rank #5) has 1,800 reviews and estimated revenue of $12,000/month. Product A is ranked higher and has more reviews."

**Example 3: Market Structure Question**
- **Question:** "How competitive is this market?"
- **Decision:** ❌ Do NOT escalate
- **Reasoning:** Market structure metrics (review barrier, price compression, brand moat, CPI) are available in `market_structure` and `brand_moat`.
- **Action:** Use market structure analysis
- **Response:** "This market shows high competitive pressure: review barrier of 2,400 reviews (median), tight price compression (±5% spread), and strong brand moat (top 3 brands control 65% of revenue)."

**Example 4: Vague Detail Request**
- **Question:** "Tell me more about product X"
- **Decision:** ❌ Do NOT escalate
- **Reasoning:** Question is vague. Can be answered with existing Page-1 data.
- **Action:** Provide summary from product card fields
- **Response:** "Product X (ASIN: B0973DGD8P) is ranked #3 organically, priced at $24.99, has 2,400 reviews with a 4.5-star rating, and estimated monthly revenue of $12,450. It's fulfilled by FBA and appears twice on Page 1 (algorithm-boosted). What specific detail would you like to know?"

---

## 7. Enforcement

### 7.1 Code Enforcement Points

This policy will be enforced in:

1. **Question Classification:**
   - `lib/ai/copilotSystemPrompt.ts` → `classifyQuestion()`
   - Add escalation decision logic

2. **Escalation Decision:**
   - `app/api/chat/route.ts` → Escalation decision function
   - Check if question requires escalation per this policy

3. **API Call Execution:**
   - `app/api/chat/route.ts` → Rainforest API call handler
   - Enforce max 2 ASINs per escalation
   - Count credits
   - Cache results

4. **User Notification:**
   - `app/analyze/ChatSidebar.tsx` → Show escalation status
   - Display "Looking up listing details..." message

### 7.2 Validation Rules

**Before making any escalation API call, validate:**
- ✅ Question explicitly requires data not in Page-1
- ✅ Data cannot be derived from estimates, rankings, or aggregates
- ✅ Maximum 2 ASINs requested
- ✅ User has been notified of escalation
- ✅ Credits will be counted
- ✅ Results will be cached

**If any validation fails, do NOT escalate. Answer using Page-1 data instead.**

---

## 8. Version History

- **v1.0 (2024)**: Initial frozen escalation policy
  - Defines strict escalation criteria
  - Lists questions that can be answered without API calls
  - Lists questions that require escalation
  - Provides complete decision table
  - Defines escalation workflow
  - Includes examples

---

**END OF ESCALATION POLICY**

