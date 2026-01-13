/**
 * Escalation Policy Rules (Frozen)
 * 
 * This module contains the exact rules from COPILOT_ESCALATION_POLICY.md
 * These rules are frozen and must not be changed without updating the policy document.
 */

/**
 * Questions that can be answered WITHOUT API calls (using Page-1 data only)
 */
export const PAGE1_ANSWERABLE_QUESTIONS = {
  MARKET_STRUCTURE: [
    "How competitive is this market?",
    "What's the review barrier?",
    "What's the price compression?",
    "What's the brand dominance?",
    "How many brands are on Page 1?",
    "What's the fulfillment mix?",
    "What's the total market size?",
    "What's the average price?",
    "How many sponsored listings?",
  ],
  PRODUCT_COMPARISON: [
    "Which product has more reviews?",
    "Which product is ranked higher?",
    "Which product has higher revenue?",
    "Which product is priced better?",
    "Why is product X ranking despite fewer reviews?",
    "Compare product A vs product B",
  ],
  REVENUE_UNITS: [
    "How much revenue does X make?",
    "How many units does X sell?",
    "What's the revenue share of X?",
    "How accurate are these estimates?",
  ],
  ALGORITHM_BOOST: [
    "Why does X appear multiple times?",
    "Which products are algorithm-boosted?",
    "What does algorithm boost mean?",
  ],
  STRATEGIC: [
    "Is this market winnable?",
    "What would kill a new launch?",
    "How can I differentiate?",
    "What's my entry strategy?",
    "Should I invest here?",
    "What would change your mind?",
  ],
};

/**
 * Questions that REQUIRE escalation (type=product API calls)
 */
export const ESCALATION_REQUIRED_QUESTIONS = {
  PRODUCT_SPECS: [
    "What are the dimensions of X?",
    "What materials is X made from?",
    "What features does X have?",
    "What's the weight of X?",
    "What color options does X have?",
    "What size options does X have?",
    "Compare dimensions of A vs B",
  ],
  PRODUCT_VARIATIONS: [
    "What color options does X have?",
    "What size options does X have?",
    "Compare variations of A vs B",
  ],
  HISTORICAL_TRENDS: [
    "How has X's price changed over time?",
    "What was X's BSR 3 months ago?",
    "Has X's ranking improved?",
  ],
  PRODUCT_DESCRIPTION: [
    "What's the full product description of X?",
    "What are the key selling points of X?",
    "What does the product description say about X?",
  ],
  SELLER_ACCOUNT: [
    "Who is the seller of X?",
    "What's the seller's rating for X?",
    "Is X sold by Amazon or third-party?",
  ],
};

/**
 * Invalid escalation reasons (never escalate for these)
 */
export const INVALID_ESCALATION_REASONS = [
  "Better accuracy",
  "Verification",
  "More detail",
  "Confidence improvement",
  "Completeness",
];

/**
 * Escalation constraints
 */
export const ESCALATION_CONSTRAINTS = {
  MAX_ASINS_PER_ESCALATION: 2,
  MAX_CREDITS_PER_SESSION: 10,
  MAX_CREDITS_PER_DAY: 50,
};

/**
 * Export policy reference for documentation
 */
export const COPILOT_ESCALATION_POLICY = {
  page1_answerable: PAGE1_ANSWERABLE_QUESTIONS,
  escalation_required: ESCALATION_REQUIRED_QUESTIONS,
  invalid_reasons: INVALID_ESCALATION_REASONS,
  constraints: ESCALATION_CONSTRAINTS,
};

