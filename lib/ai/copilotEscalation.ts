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
 * 
 * CRITICAL: Revenue and units questions MUST be answered with Page-1 estimates.
 * Never escalate for revenue/units - always use estimated_monthly_revenue and estimated_monthly_units.
 */
function canAnswerWithPage1Data(question: string, page1Context: Page1Context): boolean {
  const normalized = question.toLowerCase();
  
  // CRITICAL: Revenue/units questions - ALWAYS answerable with Page-1 estimates (checked FIRST)
  // These questions MUST NEVER escalate - estimates are the valid answer
  if (
    normalized.includes('revenue') ||
    normalized.includes('units') ||
    normalized.includes('sales') ||
    normalized.includes('earnings') ||
    normalized.includes('monthly revenue') ||
    normalized.includes('monthly units') ||
    normalized.includes('monthly sales') ||
    normalized.includes('how much revenue') ||
    normalized.includes('how many units') ||
    normalized.includes('how much does') ||
    normalized.includes('how much money') ||
    normalized.includes('revenue estimate') ||
    normalized.includes('units estimate') ||
    normalized.includes('sales estimate') ||
    normalized.includes('exact revenue') ||
    normalized.includes('exact sales') ||
    normalized.includes('actual revenue') ||
    normalized.includes('actual sales') ||
    normalized.includes('real revenue') ||
    normalized.includes('real sales')
  ) {
    // ALWAYS answerable with estimated_monthly_revenue or estimated_monthly_units
    // Never escalate - estimates are the valid answer
    return true;
  }
  
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
 * HARD ESCALATION RULE: Check if question requires product specifications
 * 
 * These questions MUST ALWAYS escalate - they cannot be answered from Page-1 data.
 * This check happens FIRST and OVERRIDES all other logic.
 */
function requiresHardEscalation(question: string): boolean {
  const normalized = question.toLowerCase();
  
  const hardEscalationKeywords = [
    'dimension', 'dimensions',
    'size',
    'weight',
    'material', 'materials',
    'construction',
    'build quality',
    'certification', 'certifications',
    'compliance',
    'variation', 'variations',
    'color option', 'color options',
    'size option', 'size options',
    "what's included",
    'in the box',
    'package contents',
    'what comes with',
    'includes',
    'specification', 'specifications', 'specs',
    'measurement', 'measurements',
    'length', 'width', 'height', 'depth', 'thickness',
    'capacity',
    'warranty',
    'ingredient', 'ingredients',
    'composition',
  ];
  
  return hardEscalationKeywords.some(keyword => normalized.includes(keyword));
}

/**
 * Main escalation decision function
 * 
 * This function implements the exact decision logic from the Escalation Policy.
 */
export function decideEscalation(
  question: string,
  page1Context: Page1Context,
  creditContext: CreditContext,
  selectedAsin?: string | null,
  selectedAsins?: string[] // Multi-ASIN support
): EscalationDecision {
  // STEP 0: HARD ESCALATION RULE (MUST CHECK FIRST - OVERRIDES ALL OTHER LOGIC)
  // If question requires product specifications, ALWAYS escalate
  if (requiresHardEscalation(question)) {
    // Get effective selected ASINs
    const effectiveSelectedAsins = selectedAsins && selectedAsins.length > 0
      ? selectedAsins
      : (selectedAsin ? [selectedAsin] : []);
    
    // CRITICAL: Must have at least 1 selected ASIN to escalate
    if (effectiveSelectedAsins.length === 0) {
      return {
        can_answer_from_page1: false,
        requires_escalation: false, // Block escalation if no ASIN selected
        required_asins: [],
        required_credits: 0,
        escalation_reason: "Select a product from Page-1 to analyze it. This question requires product specifications that are only available via product API lookup.",
      };
    }
    
    // Limit to max 2 ASINs for escalation
    if (effectiveSelectedAsins.length > 2) {
      return {
        can_answer_from_page1: false,
        requires_escalation: false,
        required_asins: [],
        required_credits: 0,
        escalation_reason: `You have ${effectiveSelectedAsins.length} products selected, but I can only look up product specifications for up to 2 products at a time. Please select 1-2 products to analyze.`,
      };
    }
    
    // HARD ESCALATION: Always require escalation for product specs
    const requiredAsins = effectiveSelectedAsins.slice(0, 2);
    const requiredCredits = requiredAsins.length;
    
    // Check if user has enough credits
    if (creditContext.available_credits < requiredCredits) {
      return {
        can_answer_from_page1: false,
        requires_escalation: true, // Still mark as requiring escalation
        required_asins: requiredAsins,
        required_credits: requiredCredits,
        escalation_reason: `This question requires product specifications. Looking up details for ${requiredAsins.length === 1 ? 'this product' : 'these products'} will use ${requiredCredits} Seller Credit${requiredCredits === 1 ? '' : 's'}, but you have insufficient credits.`,
      };
    }
    
    // HARD ESCALATION: Return decision to escalate
    return {
      can_answer_from_page1: false, // CRITICAL: Cannot answer from Page-1
      requires_escalation: true,
      required_asins: requiredAsins,
      required_credits: requiredCredits,
      escalation_reason: "product_specs_required", // Special flag for logging
      required_data: ["product_specifications"],
    };
  }
  
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
  
  // Step 1.5: HARD LOCK - Enforce selected ASINs only
  const effectiveSelectedAsins = selectedAsins && selectedAsins.length > 0
    ? selectedAsins
    : (selectedAsin ? [selectedAsin] : []);
  
  if (effectiveSelectedAsins.length > 0) {
    const extractedAsins = extractAsinsFromQuestion(question, page1Context);
    
    // Check if question mentions any ASINs that don't match selected ASINs
    if (extractedAsins.length > 0) {
      const nonMatchingAsins = extractedAsins.filter(asin => !effectiveSelectedAsins.includes(asin));
      if (nonMatchingAsins.length > 0) {
        // Question references ASINs other than selected - block escalation
        const selectedText = effectiveSelectedAsins.length === 1
          ? `the currently selected ASIN (${effectiveSelectedAsins[0]})`
          : `the currently selected ASINs (${effectiveSelectedAsins.join(', ')})`;
        return {
          can_answer_from_page1: false,
          requires_escalation: false,
          required_asins: [],
          required_credits: 0,
          escalation_reason: `I can only reference ${selectedText}. Your question mentions other ASINs (${nonMatchingAsins.join(', ')}). Please select the products you want to discuss, or clarify your question.`,
        };
      }
    }
    
    // If escalation is needed, only allow selected ASINs (max 2 for escalation)
    // Continue to Step 2 to check if escalation is actually needed
  }
  
  // Step 1.75: CRITICAL - Explicitly block escalation for revenue/units questions
  // Revenue and units questions MUST use Page-1 estimates, never escalate
  const normalizedQuestion = question.toLowerCase();
  const isRevenueUnitsQuestion = 
    normalizedQuestion.includes('revenue') ||
    normalizedQuestion.includes('units') ||
    normalizedQuestion.includes('sales') ||
    normalizedQuestion.includes('earnings') ||
    normalizedQuestion.includes('monthly revenue') ||
    normalizedQuestion.includes('monthly units') ||
    normalizedQuestion.includes('monthly sales') ||
    normalizedQuestion.includes('how much revenue') ||
    normalizedQuestion.includes('how many units') ||
    normalizedQuestion.includes('how much does') ||
    normalizedQuestion.includes('how much money');
  
  if (isRevenueUnitsQuestion) {
    // NEVER escalate for revenue/units - always use Page-1 estimates
    return {
      can_answer_from_page1: true,
      requires_escalation: false,
      required_asins: [],
      required_credits: 0,
      escalation_reason: "Revenue and units questions must be answered using Page-1 snapshot estimates (estimated_monthly_revenue, estimated_monthly_units). Escalation is not allowed for these questions.",
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
  
  // Step 3: Extract ASINs from question (or use selected ASINs if locked)
  // Use effectiveSelectedAsins computed in Step 1.5
  let asins: string[];
  
  if (effectiveSelectedAsins.length > 0) {
    // HARD LOCK: Only use selected ASINs (max 2 for escalation)
    if (effectiveSelectedAsins.length > 2) {
      // User selected more than 2 ASINs - must narrow for escalation
      return {
        can_answer_from_page1: false,
        requires_escalation: false,
        required_asins: [],
        required_credits: 0,
        escalation_reason: `You have ${effectiveSelectedAsins.length} products selected, but I can only look up details for up to 2 products at a time. Please select 1-2 products to analyze, or ask a comparison question that doesn't require deep product data.`,
      };
    }
    asins = effectiveSelectedAsins;
  } else {
    // No selected ASINs - extract from question
    asins = extractAsinsFromQuestion(question, page1Context);
    
    if (asins.length === 0) {
      // Question requires escalation but no ASINs identified
      return {
        can_answer_from_page1: false,
        requires_escalation: true,
        required_asins: [],
        required_credits: 0,
        escalation_reason: "Question requires product details, but no specific product (ASIN) was identified. Please specify which product you're asking about, or select a product from Page-1.",
      };
    }
  }
  
  // Step 4: Enforce max 2 ASINs for escalation
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
export function buildEscalationMessage(decision: EscalationDecision, selectedAsin?: string | null, selectedAsins?: string[]): string {
  if (!decision.requires_escalation) {
    return "";
  }
  
  if (decision.required_credits === 0) {
    return decision.escalation_reason;
  }
  
  // Multi-ASIN support: Reference all escalated ASINs (up to 2)
  const effectiveSelectedAsins = selectedAsins && selectedAsins.length > 0
    ? selectedAsins
    : (selectedAsin ? [selectedAsin] : []);
  
  const asinsToReference = decision.required_asins.length > 0
    ? decision.required_asins
    : effectiveSelectedAsins.slice(0, 2);
  
  // EXACT FORMAT REQUIRED:
  // For 1 ASIN: "Looking up product details for ASIN {ASIN}… (1 Seller Credit)"
  // For 2 ASINs: "Looking up product details for ASIN {A} and {B}… (2 Seller Credits)"
  const creditText = decision.required_credits === 1
    ? "1 Seller Credit"
    : `${decision.required_credits} Seller Credits`;
  
  if (asinsToReference.length === 1) {
    return `Looking up product details for ASIN ${asinsToReference[0]}… (${creditText})`;
  } else if (asinsToReference.length === 2) {
    return `Looking up product details for ASIN ${asinsToReference[0]} and ${asinsToReference[1]}… (${creditText})`;
  } else {
    // Fallback for edge cases
    const asinList = asinsToReference.join(' and ');
    return `Looking up product details for ASIN ${asinList}… (${creditText})`;
  }
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

