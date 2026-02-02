/**
 * Grounded Copilot: FactsAllowed type, builder, answer plan, and JSON validator.
 * Ensures the AI only uses data from Page-1 and cached enrichments; no hallucinated numbers.
 */

// ─── FactsAllowed (only what we already have) ─────────────────────────────

export interface FactsAllowed {
  seller_profile: {
    stage?: string | null;
    experience_months?: number | null;
    monthly_revenue_range?: string | null;
    sourcing_model?: string | null;
    goals?: string | null;
    risk_tolerance?: string | null;
    margin_target?: number | null;
    max_fee_pct?: number | null;
  };
  page1: {
    keyword: string;
    marketplace_id: string;
    amazon_domain: string;
    snapshot: {
      total_listings?: number | null;
      sponsored_count?: number | null;
      organic_count?: number | null;
      avg_price?: number | null;
      avg_reviews?: number | null;
      avg_rating?: number | null;
      total_monthly_units?: number | null;
      total_monthly_revenue?: number | null;
      top3_revenue_share_pct?: number | null;
      top_brand_revenue_share_pct?: number | null;
      brands_count?: number | null;
    };
    selected_asins: string[];
    asin_metrics: Record<
      string,
      {
        asin: string;
        title?: string | null;
        brand?: string | null;
        price?: number | null;
        rating?: number | null;
        review_count?: number | null;
        bsr?: number | null;
        main_category_bsr?: number | null;
        subcategory_rank?: number | null;
        subcategory_name?: string | null;
        estimated_monthly_units?: number | null;
        estimated_monthly_revenue?: number | null;
        sponsored?: boolean | null;
        fulfillment?: string | null;
        sources: { page1: boolean };
      }
    >;
  };
  enrichments: {
    product_dossiers?: Record<
      string,
      {
        asin: string;
        fetched_at: string;
        source: "rainforest.type_product" | "rainforest.type_reviews" | "spapi.catalog";
        rating_breakdown?: unknown;
        top_reviews?: unknown;
        feature_bullets?: string[];
        description?: string | null;
        specs?: unknown;
        weight?: unknown;
        dimensions?: unknown;
        first_available?: unknown;
      }
    >;
    fees?: Record<
      string,
      {
        asin: string;
        source: "spapi" | "estimate";
        fetched_at: string;
        fee_total?: number;
        breakdown?: unknown;
      }
    >;
  };
}

// ─── Copilot strict JSON response (frontend renders this) ───────────────────

export interface CopilotStructuredResponse {
  headline: string;
  observations: Array<{ claim: string; evidence: string[] }>;
  constraints: string[];
  followup_question: string;
  confidence: "high" | "medium" | "low";
  used_sources: { page1: boolean; rainforest: boolean; spapi: boolean };
}

// ─── Answer plan: page1_only | dossier_needed | fees_needed ────────────────

export type CopilotSourceMode = "page1_only" | "dossier_needed" | "fees_needed";

const PAGE1_ONLY_PATTERNS = [
  /\b(how competitive|competitiveness|market competitive)\b/i,
  /\b(sponsored vs organic|organic vs sponsored|break down sponsored|sponsored breakdown)\b/i,
  /\b(price range|review barrier|reviews? barrier)\b/i,
  /\b(brand dominance|top asins?|concentration|winnable|is it winnable)\b/i,
  /\b(what stands out|what do you see|summarize|summary)\b/i,
  /\b(market overview|page 1|page one)\b/i,
];

const DOSSIER_PATTERNS = [
  /\b(what do people dislike|dislike|complaints?|negative reviews?)\b/i,
  /\b(summarize reviews?|review themes?|rating split|rating breakdown)\b/i,
  /\b(how long has this (listing|product) been (live|up)|first available|launch date)\b/i,
  /\b(specs?|dimensions?|features?|feature bullets?|description|weight)\b/i,
];

const FEES_PATTERNS = [
  /\b(run fees|fees for|fba fees?|amazon fees?)\b/i,
  /\b(profitability|profitable|margin target|good profitability)\b/i,
  /\b(is this good (at|with)|at (\d+)% margin)\b/i,
];

export function getAnswerPlan(
  message: string,
  selectedAsinsCount: number
): { mode: CopilotSourceMode; requiresAsins: boolean } {
  const normalized = message.toLowerCase().trim();

  if (FEES_PATTERNS.some((p) => p.test(normalized))) {
    return { mode: "fees_needed", requiresAsins: selectedAsinsCount < 1 };
  }
  if (DOSSIER_PATTERNS.some((p) => p.test(normalized))) {
    return { mode: "dossier_needed", requiresAsins: selectedAsinsCount < 1 };
  }
  // Default: answer from Page-1 only
  return { mode: "page1_only", requiresAsins: false };
}

// ─── Build FactsAllowed from analysis response + seller profile ─────────────

export function buildFactsAllowed(
  analysisResponse: Record<string, unknown>,
  sellerProfile: {
    stage?: string | null;
    experience_months?: number | null;
    monthly_revenue_range?: string | null;
    sourcing_model?: string | null;
    goals?: string | null;
    risk_tolerance?: string | null;
    margin_target?: number | null;
    max_fee_pct?: number | null;
  },
  selectedAsins: string[],
  marketplaceId: string = "ATVPDKIKX0DER",
  amazonDomain: string = "amazon.com",
  enrichments?: {
    product_dossiers?: FactsAllowed["enrichments"]["product_dossiers"];
    fees?: FactsAllowed["enrichments"]["fees"];
  }
): FactsAllowed {
  const marketSnapshot = (analysisResponse.market_snapshot as Record<string, unknown>) || null;
  const ms = marketSnapshot || {};
  const summary = (analysisResponse.aggregates_derived_from_page_one as Record<string, unknown>) || (analysisResponse.summary as Record<string, unknown>) || {};
  const listings = (analysisResponse.page_one_listings as any[]) || (analysisResponse.products as any[]) || [];

  const snapshot = {
    total_listings: (ms.total_page1_listings as number) ?? (summary.page1_product_count as number) ?? (listings.length || null),
    sponsored_count: (ms.sponsored_count as number) ?? null,
    organic_count: typeof ms.organic_count === "number" ? ms.organic_count : null,
    avg_price: (ms.avg_price as number) ?? (summary.avg_price as number) ?? null,
    avg_reviews: (ms.avg_reviews as number) ?? (summary.avg_reviews as number) ?? null,
    avg_rating: (ms.avg_rating as number) ?? (summary.avg_rating as number) ?? null,
    total_monthly_units: (summary.total_monthly_units_est as number) ?? null,
    total_monthly_revenue: (summary.total_monthly_revenue_est as number) ?? null,
    top3_revenue_share_pct: (analysisResponse.market_snapshot as any)?.top_3_brands_revenue_share_pct ?? (analysisResponse.brand_moat as any)?.top_3_brands_revenue_share_pct ?? null,
    top_brand_revenue_share_pct: (analysisResponse.brand_moat as any)?.top_brand_revenue_share_pct ?? null,
    brands_count: (analysisResponse.brand_moat as any)?.total_brands_count ?? null,
  };

  const asin_metrics: FactsAllowed["page1"]["asin_metrics"] = {};
  for (const listing of listings) {
    if (!listing?.asin) continue;
    const asin = String(listing.asin).trim().toUpperCase();
    asin_metrics[asin] = {
      asin,
      title: listing.title ?? null,
      brand: listing.brand ?? null,
      price: typeof listing.price === "number" ? listing.price : null,
      rating: typeof listing.rating === "number" ? listing.rating : null,
      review_count: typeof listing.review_count === "number" ? listing.review_count : (typeof listing.reviews === "number" ? listing.reviews : null),
      bsr: typeof listing.bsr === "number" ? listing.bsr : (typeof listing.main_category_bsr === "number" ? listing.main_category_bsr : null),
      main_category_bsr: typeof listing.main_category_bsr === "number" ? listing.main_category_bsr : null,
      subcategory_rank: typeof listing.subcategory_rank === "number" ? listing.subcategory_rank : null,
      subcategory_name: listing.subcategory_name ?? null,
      estimated_monthly_units: typeof listing.estimated_monthly_units === "number" ? listing.estimated_monthly_units : null,
      estimated_monthly_revenue: typeof listing.estimated_monthly_revenue === "number" ? listing.estimated_monthly_revenue : null,
      sponsored: listing.is_sponsored ?? listing.appearsSponsored ?? null,
      fulfillment: listing.fulfillment ?? null,
      sources: { page1: true },
    };
  }

  const page1: FactsAllowed["page1"] = {
    keyword: (analysisResponse.input_value as string) || (ms.keyword as string) || "",
    marketplace_id: marketplaceId,
    amazon_domain: amazonDomain,
    snapshot,
    selected_asins: selectedAsins.filter(Boolean),
    asin_metrics,
  };

  return {
    seller_profile: {
      stage: sellerProfile.stage ?? null,
      experience_months: sellerProfile.experience_months ?? null,
      monthly_revenue_range: sellerProfile.monthly_revenue_range ?? null,
      sourcing_model: sellerProfile.sourcing_model ?? null,
      goals: sellerProfile.goals ?? null,
      risk_tolerance: sellerProfile.risk_tolerance ?? null,
      margin_target: sellerProfile.margin_target ?? null,
      max_fee_pct: sellerProfile.max_fee_pct ?? null,
    },
    page1,
    enrichments: {
      product_dossiers: enrichments?.product_dossiers,
      fees: enrichments?.fees,
    },
  };
}

// ─── Extract all numeric tokens from a string (for grounding check) ────────

function extractNumericTokens(s: string): Set<string> {
  const tokens = new Set<string>();
  // Numbers: integers, decimals, percentages, currency
  const re = /\d+(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    tokens.add(m[0]);
  }
  return tokens;
}

// ─── Validator: reject hallucinated numbers, enforce schema ────────────────

export function validateCopilotJson(
  json: unknown,
  factsAllowedSerialized: string
): { valid: boolean; parsed?: CopilotStructuredResponse; error?: string } {
  if (typeof json !== "object" || json === null) {
    return { valid: false, error: "Response is not an object" };
  }
  const o = json as Record<string, unknown>;

  const headline = o.headline;
  if (typeof headline !== "string" || !headline.trim()) {
    return { valid: false, error: "Missing or invalid headline" };
  }

  const observations = o.observations;
  if (!Array.isArray(observations)) {
    return { valid: false, error: "observations must be an array" };
  }
  if (observations.length > 4) {
    return { valid: false, error: "observations.length must be <= 4" };
  }
  const allowedNums = extractNumericTokens(factsAllowedSerialized);
  for (const obs of observations) {
    if (typeof obs !== "object" || obs === null) continue;
    const claim = (obs as { claim?: unknown }).claim;
    if (typeof claim !== "string") continue;
    const claimNums = extractNumericTokens(claim);
    for (const num of claimNums) {
      if (!allowedNums.has(num)) {
        return { valid: false, error: `Observation claim contains number "${num}" not present in FACTS_ALLOWED` };
      }
    }
  }

  const constraints = o.constraints;
  if (!Array.isArray(constraints)) {
    return { valid: false, error: "constraints must be an array" };
  }
  if (constraints.length > 4) {
    return { valid: false, error: "constraints.length must be <= 4" };
  }

  const followup_question = o.followup_question;
  if (typeof followup_question !== "string" || !followup_question.trim()) {
    return { valid: false, error: "Missing or invalid followup_question" };
  }
  if (!followup_question.trim().endsWith("?")) {
    return { valid: false, error: "followup_question must end with ?" };
  }

  const confidence = o.confidence;
  if (confidence !== "high" && confidence !== "medium" && confidence !== "low") {
    return { valid: false, error: "confidence must be high, medium, or low" };
  }

  const used_sources = o.used_sources;
  if (typeof used_sources !== "object" || used_sources === null) {
    return { valid: false, error: "Missing used_sources" };
  }
  const us = used_sources as Record<string, unknown>;
  if (typeof us.page1 !== "boolean" || typeof us.rainforest !== "boolean" || typeof us.spapi !== "boolean") {
    return { valid: false, error: "used_sources must have page1, rainforest, spapi as booleans" };
  }

  const parsed: CopilotStructuredResponse = {
    headline: String(headline).trim(),
    observations: observations.map((ob: unknown) => {
      const x = ob as { claim?: string; evidence?: string[] };
      return {
        claim: typeof x.claim === "string" ? x.claim : "",
        evidence: Array.isArray(x.evidence) ? x.evidence.filter((e): e is string => typeof e === "string") : [],
      };
    }),
    constraints: constraints.filter((c): c is string => typeof c === "string"),
    followup_question: String(followup_question).trim(),
    confidence: confidence as "high" | "medium" | "low",
    used_sources: {
      page1: Boolean(us.page1),
      rainforest: Boolean(us.rainforest),
      spapi: Boolean(us.spapi),
    },
  };
  return { valid: true, parsed };
}
