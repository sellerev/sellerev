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
 * Maps seller_profiles table data to seller_memory format
 */
export function mapSellerProfileToMemory(
  profile: {
    stage: string;
    experience_months: number | null;
    monthly_revenue_range: string | null;
    sourcing_model: string;
  }
): Partial<SellerProfileMemory> {
  // Map stage
  let stage: SellerStage = "pre-launch";
  if (profile.stage === "new") stage = "pre-launch";
  else if (profile.stage === "existing") stage = "launching";
  else if (profile.stage === "scaling") stage = "scaling";
  else if (profile.stage === "established") stage = "established";

  // Map experience level
  let experience_level: ExperienceLevel = "new";
  if (profile.experience_months === null || profile.experience_months === 0) {
    experience_level = "new";
  } else if (profile.experience_months < 12) {
    experience_level = "new";
  } else if (profile.experience_months < 36) {
    experience_level = "intermediate";
  } else {
    experience_level = "advanced";
  }

  // Map sourcing model
  let sourcing_model: SourcingModel = "private_label";
  if (profile.sourcing_model === "private_label") sourcing_model = "china";
  else if (profile.sourcing_model === "wholesale_arbitrage") sourcing_model = "wholesale";
  else if (profile.sourcing_model === "retail_arbitrage") sourcing_model = "domestic";
  else sourcing_model = "private_label";

  return {
    stage,
    experience_level,
    monthly_revenue_range: profile.monthly_revenue_range,
    sourcing_model,
  };
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
