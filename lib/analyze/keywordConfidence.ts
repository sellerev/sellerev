/**
 * Keyword Confidence & Learning Layer
 * 
 * Tracks historical observations and computes confidence metrics for keyword analysis.
 * This is an additive layer that never blocks or breaks analysis.
 */

export interface ConfidenceObservation {
  keyword: string;
  market: string;
  observed_total_units: number;
  observed_total_revenue: number;
  run_id: string;
  timestamp: string;
}

export interface ConfidenceStats {
  run_count: number;
  average_units: number;
  average_revenue: number;
  std_dev_units: number;
  std_dev_revenue: number;
  coefficient_of_variation_units: number; // CV = (std_dev / mean) * 100
  coefficient_of_variation_revenue: number;
}

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export interface ConfidenceMetadata {
  confidence_level: ConfidenceLevel;
  run_count: number;
  confidence_range_units: [number, number]; // [mean - std, mean + std]
  confidence_range_revenue: [number, number];
}

/**
 * Insert a confidence observation after successful keyword analysis
 */
export async function insertConfidenceObservation(
  supabase: any,
  observation: ConfidenceObservation
): Promise<void> {
  try {
    await supabase
      .from("keyword_confidence_observations")
      .insert({
        keyword: observation.keyword,
        market: observation.market,
        observed_total_units: observation.observed_total_units,
        observed_total_revenue: observation.observed_total_revenue,
        run_id: observation.run_id,
        timestamp: observation.timestamp,
      });
  } catch (error) {
    console.error("Failed to insert confidence observation:", error);
    // Don't throw - observation insertion is non-critical
  }
}

/**
 * Aggregate past observations for a keyword and market
 */
export async function getConfidenceStats(
  supabase: any,
  keyword: string,
  market: string
): Promise<ConfidenceStats | null> {
  try {
    const { data: observations, error } = await supabase
      .from("keyword_confidence_observations")
      .select("observed_total_units, observed_total_revenue")
      .eq("keyword", keyword)
      .eq("market", market)
      .order("timestamp", { ascending: false });

    if (error || !observations || observations.length === 0) {
      return null;
    }

    const units = observations.map((o: any) => parseFloat(o.observed_total_units) || 0);
    const revenues = observations.map((o: any) => parseFloat(o.observed_total_revenue) || 0);

    const run_count = observations.length;

    // Calculate means
    const average_units = units.reduce((sum, val) => sum + val, 0) / run_count;
    const average_revenue = revenues.reduce((sum, val) => sum + val, 0) / run_count;

    // Calculate standard deviations
    const variance_units = units.reduce((sum, val) => sum + Math.pow(val - average_units, 2), 0) / run_count;
    const variance_revenue = revenues.reduce((sum, val) => sum + Math.pow(val - average_revenue, 2), 0) / run_count;
    
    const std_dev_units = Math.sqrt(variance_units);
    const std_dev_revenue = Math.sqrt(variance_revenue);

    // Calculate coefficient of variation (CV = std/mean * 100)
    const coefficient_of_variation_units = average_units > 0 ? (std_dev_units / average_units) * 100 : 0;
    const coefficient_of_variation_revenue = average_revenue > 0 ? (std_dev_revenue / average_revenue) * 100 : 0;

    return {
      run_count,
      average_units,
      average_revenue,
      std_dev_units,
      std_dev_revenue,
      coefficient_of_variation_units,
      coefficient_of_variation_revenue,
    };
  } catch (error) {
    console.error("Failed to get confidence stats:", error);
    return null;
  }
}

/**
 * Derive confidence level from stats
 * 
 * Rules:
 * - HIGH: run_count ≥ 5 AND CV < 10%
 * - MEDIUM: run_count ≥ 2
 * - LOW: run_count = 1
 */
export function deriveConfidenceLevel(stats: ConfidenceStats | null): ConfidenceLevel {
  if (!stats) {
    return "LOW";
  }

  if (stats.run_count >= 5 && stats.coefficient_of_variation_units < 10) {
    return "HIGH";
  }

  if (stats.run_count >= 2) {
    return "MEDIUM";
  }

  return "LOW";
}

/**
 * Compute confidence metadata from stats
 */
export function computeConfidenceMetadata(
  stats: ConfidenceStats | null
): ConfidenceMetadata | null {
  if (!stats) {
    return null;
  }

  const confidence_level = deriveConfidenceLevel(stats);

  const confidence_range_units: [number, number] = [
    Math.max(0, stats.average_units - stats.std_dev_units),
    stats.average_units + stats.std_dev_units,
  ];

  const confidence_range_revenue: [number, number] = [
    Math.max(0, stats.average_revenue - stats.std_dev_revenue),
    stats.average_revenue + stats.std_dev_revenue,
  ];

  return {
    confidence_level,
    run_count: stats.run_count,
    confidence_range_units,
    confidence_range_revenue,
  };
}

