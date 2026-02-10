/**
 * Seller Memory System
 * 
 * Persistent, project-aware memory for AI Copilot.
 * Memory shapes future answers but NEVER changes historical data.
 * 
 * Rules:
 * - Memory updates require explicit user confirmation
 * - Never infer irreversible facts without confirmation
 * - Memory updates must be explainable
 */

export type SellerStage = "pre-launch" | "launching" | "scaling" | "established";
export type ExperienceLevel = "new" | "intermediate" | "advanced";
export type SourcingModel = "china" | "domestic" | "private_label" | "wholesale";
export type CapitalConstraints = "low" | "medium" | "high";
export type RiskTolerance = "low" | "medium" | "high";
export type PricingSensitivity = "low" | "medium" | "high";

export interface SellerProfileMemory {
  stage: SellerStage;
  experience_level: ExperienceLevel;
  monthly_revenue_range: string | null;
  sourcing_model: SourcingModel;
  capital_constraints: CapitalConstraints;
  risk_tolerance: RiskTolerance;
  target_margin_pct: number | null;
  long_term_goal: string | null;
  /** Business page: single source of truth for AI personalization */
  primary_goal?: string | null;
  timeline_days?: number | null;
  success_definition?: string | null;
  current_focus?: string | null;
  constraints?: string[] | null;
  notes_constraints?: string | null;
  marketplaces?: string[] | null;
  target_price_min?: number | null;
  target_price_max?: number | null;
  max_fee_pct?: number | null;
  target_net_profit_per_unit?: number | null;
  review_barrier_tolerance?: string | null;
  competition_tolerance?: string | null;
  ad_spend_tolerance?: string | null;
  brand_strategy?: string | null;
  uses_fba?: boolean | null;
  amazon_connected?: boolean | null;
}

export interface SellerPreferences {
  prefers_data_over_summary: boolean;
  dislikes_scores_only: boolean;
  wants_h10_style_numbers: boolean;
  pricing_sensitivity: PricingSensitivity;
}

export interface SavedAssumptions {
  default_cogs_pct: number | null;
  default_launch_budget: number | null;
  default_acos_target: number | null;
}

export interface HistoricalContext {
  analyzed_keywords: string[];
  analyzed_asins: string[];
  rejected_opportunities: string[];
  accepted_opportunities: string[];
}

export interface SellerMemory {
  seller_profile: SellerProfileMemory;
  preferences: SellerPreferences;
  saved_assumptions: SavedAssumptions;
  historical_context: HistoricalContext;
  updated_at: string; // ISO timestamp
  version: number; // Schema version for migration
}

/**
 * Default seller memory (used when no memory exists)
 */
export function createDefaultSellerMemory(): SellerMemory {
  return {
    seller_profile: {
      stage: "pre-launch",
      experience_level: "new",
      monthly_revenue_range: null,
      sourcing_model: "private_label",
      capital_constraints: "medium",
      risk_tolerance: "medium",
      target_margin_pct: null,
      long_term_goal: null,
    },
    preferences: {
      prefers_data_over_summary: true,
      dislikes_scores_only: true,
      wants_h10_style_numbers: true,
      pricing_sensitivity: "medium",
    },
    saved_assumptions: {
      default_cogs_pct: null,
      default_launch_budget: null,
      default_acos_target: null,
    },
    historical_context: {
      analyzed_keywords: [],
      analyzed_asins: [],
      rejected_opportunities: [],
      accepted_opportunities: [],
    },
    updated_at: new Date().toISOString(),
    version: 1,
  };
}

/**
 * Maps seller_profiles table data to seller_memory format.
 * Passes through Business page fields for AI personalization.
 */
export function mapSellerProfileToMemory(profile: Record<string, unknown>): Partial<SellerProfileMemory> {
  const stageStr = profile.stage as string | undefined;
  const experience_months = profile.experience_months as number | null | undefined;
  const monthly_revenue_range = profile.monthly_revenue_range as string | null | undefined;
  const sourcing_model_str = profile.sourcing_model as string | undefined;

  let stage: SellerStage = "pre-launch";
  if (stageStr === "new" || stageStr === "just_starting") stage = "pre-launch";
  else if (stageStr === "existing" || stageStr === "existing_seller") stage = "launching";
  else if (stageStr === "scaling" || stageStr === "scaling_brand") stage = "scaling";
  else if (stageStr === "established") stage = "established";

  let experience_level: ExperienceLevel = "new";
  if (experience_months == null || experience_months === 0) experience_level = "new";
  else if (experience_months < 12) experience_level = "new";
  else if (experience_months < 36) experience_level = "intermediate";
  else experience_level = "advanced";

  let sourcing_model: SourcingModel = "private_label";
  if (sourcing_model_str === "private_label") sourcing_model = "china";
  else if (sourcing_model_str === "wholesale_arbitrage" || sourcing_model_str === "wholesale") sourcing_model = "wholesale";
  else if (sourcing_model_str === "retail_arbitrage") sourcing_model = "domestic";
  else if (sourcing_model_str) sourcing_model = "private_label";

  const base: Partial<SellerProfileMemory> = {
    stage,
    experience_level,
    monthly_revenue_range: monthly_revenue_range ?? null,
    sourcing_model,
    primary_goal: (profile.primary_goal as string | null) ?? null,
    timeline_days: (profile.timeline_days as number | null) ?? null,
    success_definition: (profile.success_definition as string | null) ?? null,
    current_focus: (profile.current_focus as string | null) ?? null,
    constraints: Array.isArray(profile.constraints) ? profile.constraints : null,
    notes_constraints: (profile.notes_constraints as string | null) ?? null,
    marketplaces: Array.isArray(profile.marketplaces) ? profile.marketplaces : null,
    target_price_min: (profile.target_price_min as number | null) ?? null,
    target_price_max: (profile.target_price_max as number | null) ?? null,
    max_fee_pct: (profile.max_fee_pct as number | null) ?? null,
    target_net_profit_per_unit: (profile.target_net_profit_per_unit as number | null) ?? null,
    review_barrier_tolerance: (profile.review_barrier_tolerance as string | null) ?? null,
    competition_tolerance: (profile.competition_tolerance as string | null) ?? null,
    ad_spend_tolerance: (profile.ad_spend_tolerance as string | null) ?? null,
    brand_strategy: (profile.brand_strategy as string | null) ?? null,
    uses_fba: profile.uses_fba as boolean | null | undefined,
    amazon_connected: profile.amazon_connected as boolean | null | undefined,
  };
  if (profile.goals != null) (base as Record<string, unknown>).long_term_goal = profile.goals;
  const rt = profile.risk_tolerance as string | null | undefined;
  if (rt === "low" || rt === "medium" || rt === "high") (base as Record<string, unknown>).risk_tolerance = rt;
  if (profile.margin_target != null || profile.margin_target_pct != null) (base as Record<string, unknown>).target_margin_pct = (profile.margin_target_pct ?? profile.margin_target) as number;
  return base;
}

/**
 * Validates seller memory structure
 */
export function validateSellerMemory(memory: unknown): memory is SellerMemory {
  if (typeof memory !== "object" || memory === null) return false;
  
  const m = memory as Record<string, unknown>;
  
  // Check required top-level fields
  if (!m.seller_profile || !m.preferences || !m.saved_assumptions || !m.historical_context) {
    return false;
  }
  
  // Validate seller_profile
  const profile = m.seller_profile as Record<string, unknown>;
  const validStages = ["pre-launch", "launching", "scaling", "established"];
  const validExperience = ["new", "intermediate", "advanced"];
  const validSourcing = ["china", "domestic", "private_label", "wholesale"];
  
  if (!validStages.includes(profile.stage as string)) return false;
  if (!validExperience.includes(profile.experience_level as string)) return false;
  if (!validSourcing.includes(profile.sourcing_model as string)) return false;
  
  // Validate preferences
  const prefs = m.preferences as Record<string, unknown>;
  if (typeof prefs.prefers_data_over_summary !== "boolean") return false;
  if (typeof prefs.dislikes_scores_only !== "boolean") return false;
  if (typeof prefs.wants_h10_style_numbers !== "boolean") return false;
  
  // Validate historical_context
  const history = m.historical_context as Record<string, unknown>;
  if (!Array.isArray(history.analyzed_keywords)) return false;
  if (!Array.isArray(history.analyzed_asins)) return false;
  if (!Array.isArray(history.rejected_opportunities)) return false;
  if (!Array.isArray(history.accepted_opportunities)) return false;
  
  return true;
}
