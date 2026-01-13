/**
 * Copilot Escalation Decision Engine
 * 
 * This module implements the exact escalation decision logic from:
 * - Page-1 Contract (frozen)
 * - Escalation Policy (frozen)
 * - Credit & Pricing Policy (frozen)
 * 
 * Core Principle: Copilot must prefer estimates and reasoning over verification.
 * "Better accuracy" alone is NOT a valid reason to escalate.
 */

import { COPILOT_ESCALATION_POLICY } from "./escalationPolicyRules";

/**
 * Escalation decision result
 */
export interface EscalationDecision {
  // Can the question be answered using Page-1 data only?
  can_answer_from_page1: boolean;
  
  // Does this question require escalation to type=product API?
  requires_escalation: boolean;
  
  // Which ASINs need to be looked up (max 2)
  required_asins: string[];
  
  // How many credits will this cost (0, 1, or 2)
  required_credits: number;
  
  // Human-readable reason for escalation (or why not)
  escalation_reason: string;
  
  // What data is needed (if escalation required)
  required_data?: string[];
}

/**
 * Page-1 context available to Copilot
 */
export interface Page1Context {
  // Product cards from Page-1 analysis
  products: Array<{
    asin: string;
    title: string | null;
    price: number;
    rating: number;
    review_count: number;
    bsr: number | null;
    estimated_monthly_units: number;
    estimated_monthly_revenue: number;
    revenue_share_pct: number;
    fulfillment: "FBA" | "FBM" | "AMZ";
    organic_rank: number | null;
    page_position: number;
    is_sponsored: boolean;
    page_one_appearances: number;
    is_algorithm_boosted: boolean;
  }>;
  
  // Market snapshot aggregates
  market_snapshot: {
    avg_price: number;
    avg_rating: number;
    avg_bsr: number | null;
    total_monthly_units_est: number;
    total_monthly_revenue_est: number;
    page1_product_count: number;
    sponsored_count: number | null;
  };
  
  // Market structure
  market_structure: {
    price_band: { min: number; max: number; tightness: string };
    fulfillment_mix: { fba_pct: number; fbm_pct: number; amazon_pct: number };
    review_barrier: { median_reviews: number; top_5_avg_reviews: number };
    page1_density: number;
  };
  
  // Brand moat (if available)
  brand_moat?: {
    moat_strength: string;
    total_brands_count: number;
    top_brand_revenue_share_pct: number;
    top_3_brands_revenue_share_pct: number;
  };
}

/**
 * Credit availability context
 */
export interface CreditContext {
  // Available credits (free + purchased)
  available_credits: number;
  
  // Credits used in current session
  session_credits_used: number;
  
  // Credits used in last 24 hours
  daily_credits_used: number;
  
  // Maximum credits per session
  max_session_credits?: number; // Default: 10
  
  // Maximum credits per day
  max_daily_credits?: number; // Default: 50
}

/**
 * Extract ASINs mentioned in question
 */
function extractAsinsFromQuestion(question: string, page1Context: Page1Context): string[] {
  const asins: string[] = [];
  const normalized = question.toLowerCase();
  
  // Look for ASIN patterns (B followed by alphanumeric, typically 10 chars)
  const asinPattern = /\b(B[A-Z0-9]{9})\b/gi;
  const matches = question.match(asinPattern);
  if (matches) {
    asins.push(...matches.map(m => m.toUpperCase()));
  }
  
  // Look for product references by rank ("product #3", "rank 5", "3rd listing")
  const rankPatterns = [
    /(?:product|listing|rank|position)\s*(?:#|number)?\s*(\d+)/gi,
    /(?:#|rank|position)\s*(\d+)/gi,
    /(\d+)(?:st|nd|rd|th)\s*(?:product|listing|rank)/gi,
  ];
  
  for (const pattern of rankPatterns) {
    const rankMatches = question.match(pattern);
    if (rankMatches) {
      for (const match of rankMatches) {
        const rankNum = parseInt(match.replace(/\D/g, ''), 10);
        if (rankNum > 0 && rankNum <= page1Context.products.length) {
          const product = page1Context.products[rankNum - 1];
          if (product && !asins.includes(product.asin)) {
            asins.push(product.asin);
          }
        }
      }
    }
  }
  
  // Look for product references by title (partial matches)
  // This is a fallback - prefer explicit ASINs or ranks
  const productTitles = page1Context.products.map(p => p.title?.toLowerCase() || '').filter(Boolean);
  for (const title of productTitles) {
    const titleWords = title.split(/\s+/).slice(0, 3); // First 3 words
    if (titleWords.some(word => normalized.includes(word.toLowerCase()))) {
      const product = page1Context.products.find(p => p.title?.toLowerCase() === title);
      if (product && !asins.includes(product.asin)) {
        asins.push(product.asin);
      }
    }
  }
  
  return asins.slice(0, 2); // Max 2 ASINs
}

/**
 * Check if question requires product specifications
 */
function requiresSpecifications(question: string): boolean {
  const normalized = question.toLowerCase();
  const specKeywords = [
    'dimension', 'size', 'weight', 'material', 'specification', 'spec',
    'measurement', 'length', 'width', 'height', 'depth', 'thickness',
    'color option', 'size option', 'variation', 'variant', 'option',
    'feature', 'bullet point', 'description', 'detail',
  ];
  
  return specKeywords.some(keyword => normalized.includes(keyword));
}

/**
 * Check if question requires historical data
 */
function requiresHistoricalData(question: string): boolean {
  const normalized = question.toLowerCase();
  const historicalKeywords = [
    'history', 'historical', 'trend', 'change over time', 'past',
    'previous', 'before', 'ago', 'month ago', 'week ago',
    'improved', 'declined', 'increased', 'decreased',
  ];
  
  return historicalKeywords.some(keyword => normalized.includes(keyword));
}

/**
 * Check if question requires seller account information
 */
function requiresSellerInfo(question: string): boolean {
  const normalized = question.toLowerCase();
  const sellerKeywords = [
    'seller name', 'who is the seller', 'seller rating',
    'seller account', 'sold by', 'seller information',
  ];
  
  // Note: fulfillment (FBA/FBM/AMZ) is available on Page-1, so don't escalate for that
  return sellerKeywords.some(keyword => normalized.includes(keyword));
}

/**
 * Check if question can be answered with Page-1 data
 */
function canAnswerWithPage1Data(question: string, page1Context: Page1Context): boolean {
  const normalized = question.toLowerCase();
  
  // Market structure questions - always answerable from Page-1
  if (
    normalized.includes('competitive') ||
    normalized.includes('review barrier') ||
    normalized.includes('price compression') ||
    normalized.includes('brand dominance') ||
    normalized.includes('fulfillment mix') ||
    normalized.includes('market size') ||
    normalized.includes('total revenue') ||
    normalized.includes('total units') ||
    normalized.includes('average price') ||
    normalized.includes('average rating')
  ) {
    return true;
  }
  
  // Product comparison questions - answerable if using Page-1 fields
  if (
    normalized.includes('compare') ||
    normalized.includes('versus') ||
    normalized.includes('vs') ||
    normalized.includes('difference between') ||
    normalized.includes('which is better')
  ) {
    // Can compare using price, reviews, rank, revenue estimates
    return true;
  }
  
  // Revenue/units questions - answerable with estimates
  if (
    normalized.includes('revenue') ||
    normalized.includes('units') ||
    normalized.includes('sales') ||
    normalized.includes('earnings')
  ) {
    // Can answer with estimated_monthly_revenue or estimated_monthly_units
    return true;
  }
  
  // Ranking questions - answerable from Page-1
  if (
    normalized.includes('rank') ||
    normalized.includes('position') ||
    normalized.includes('algorithm boost') ||
    normalized.includes('appear multiple times')
  ) {
    return true;
  }
  
  // Strategic questions - answerable with market structure
  if (
    normalized.includes('winnable') ||
    normalized.includes('strategy') ||
    normalized.includes('differentiate') ||
    normalized.includes('entry') ||
    normalized.includes('risk') ||
    normalized.includes('should i invest')
  ) {
    return true;
  }
  
  return false;
}

/**
 * Main escalation decision function
 * 
 * This function implements the exact decision logic from the Escalation Policy.
 */
export function decideEscalation(
  question: string,
  page1Context: Page1Context,
  creditContext: CreditContext
): EscalationDecision {
  // Step 1: Check if question can be answered with Page-1 data
  const canAnswerPage1 = canAnswerWithPage1Data(question, page1Context);
  
  if (canAnswerPage1) {
    return {
      can_answer_from_page1: true,
      requires_escalation: false,
      required_asins: [],
      required_credits: 0,
      escalation_reason: "Question can be answered using Page-1 data (market structure, estimates, rankings, or comparisons).",
    };
  }
  
  // Step 2: Check if question requires escalation
  const needsSpecs = requiresSpecifications(question);
  const needsHistory = requiresHistoricalData(question);
  const needsSellerInfo = requiresSellerInfo(question);
  
  if (!needsSpecs && !needsHistory && !needsSellerInfo) {
    // Question doesn't explicitly require missing data
    // Try to answer with Page-1 data anyway (qualitative reasoning)
    return {
      can_answer_from_page1: true,
      requires_escalation: false,
      required_asins: [],
      required_credits: 0,
      escalation_reason: "Question can be answered using Page-1 data with qualitative reasoning.",
    };
  }
  
  // Step 3: Extract ASINs from question
  const asins = extractAsinsFromQuestion(question, page1Context);
  
  if (asins.length === 0) {
    // Question requires escalation but no ASINs identified
    return {
      can_answer_from_page1: false,
      requires_escalation: true,
      required_asins: [],
      required_credits: 0,
      escalation_reason: "Question requires product details, but no specific product (ASIN) was identified. Please specify which product you're asking about.",
    };
  }
  
  // Step 4: Enforce max 2 ASINs
  const requiredAsins = asins.slice(0, 2);
  const requiredCredits = requiredAsins.length;
  
  // Step 5: Check credit limits
  const maxSessionCredits = creditContext.max_session_credits ?? 10;
  const maxDailyCredits = creditContext.max_daily_credits ?? 50;
  
  const hasEnoughCredits = creditContext.available_credits >= requiredCredits;
  const sessionLimitOk = (creditContext.session_credits_used + requiredCredits) <= maxSessionCredits;
  const dailyLimitOk = (creditContext.daily_credits_used + requiredCredits) <= maxDailyCredits;
  
  if (!hasEnoughCredits) {
    return {
      can_answer_from_page1: false,
      requires_escalation: true,
      required_asins: requiredAsins,
      required_credits: requiredCredits,
      escalation_reason: `This lookup requires ${requiredCredits} credit(s), but you have ${creditContext.available_credits} credit(s) remaining. Purchase credits to continue.`,
    };
  }
  
  if (!sessionLimitOk) {
    return {
      can_answer_from_page1: false,
      requires_escalation: true,
      required_asins: requiredAsins,
      required_credits: requiredCredits,
      escalation_reason: `This lookup would exceed the session limit of ${maxSessionCredits} credits. You've used ${creditContext.session_credits_used} credits this session.`,
    };
  }
  
  if (!dailyLimitOk) {
    return {
      can_answer_from_page1: false,
      requires_escalation: true,
      required_asins: requiredAsins,
      required_credits: requiredCredits,
      escalation_reason: `This lookup would exceed the daily limit of ${maxDailyCredits} credits. You've used ${creditContext.daily_credits_used} credits in the last 24 hours.`,
    };
  }
  
  // Step 6: Determine what data is needed
  const requiredData: string[] = [];
  if (needsSpecs) {
    requiredData.push("product specifications");
  }
  if (needsHistory) {
    requiredData.push("historical data");
  }
  if (needsSellerInfo) {
    requiredData.push("seller information");
  }
  
  // Step 7: Return escalation decision
  return {
    can_answer_from_page1: false,
    requires_escalation: true,
    required_asins: requiredAsins,
    required_credits: requiredCredits,
    escalation_reason: `Question requires ${requiredData.join(" and ")} not available in Page-1 data. Looking up product details for ${requiredAsins.join(" and ")}.`,
    required_data: requiredData,
  };
}

/**
 * Build escalation notification message for user
 */
export function buildEscalationMessage(decision: EscalationDecision): string {
  if (!decision.requires_escalation) {
    return "";
  }
  
  if (decision.required_credits === 0) {
    return decision.escalation_reason;
  }
  
  const asinList = decision.required_asins.length === 1
    ? decision.required_asins[0]
    : `${decision.required_asins[0]} and ${decision.required_asins[1]}`;
  
  const creditText = decision.required_credits === 1
    ? "1 credit"
    : `${decision.required_credits} credits`;
  
  return `Looking up product details for ${asinList}... (${creditText})`;
}

/**
 * Build insufficient credits message
 */
export function buildInsufficientCreditsMessage(decision: EscalationDecision, creditContext: CreditContext): string {
  if (decision.required_credits === 0) {
    return "";
  }
  
  const asinList = decision.required_asins.length === 1
    ? decision.required_asins[0]
    : `${decision.required_asins[0]} and ${decision.required_asins[1]}`;
  
  return `I can't look up detailed product information for ${asinList} right now because you don't have enough credits.

This lookup would cost ${decision.required_credits} credit(s), but you have ${creditContext.available_credits} credit(s) remaining.

You can still:
- Ask questions about Page-1 data (free)
- Compare products using available data (free)
- Get strategic advice based on market structure (free)

To look up detailed product information, purchase credits.`;
}

