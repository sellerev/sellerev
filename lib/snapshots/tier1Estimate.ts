/**
 * Tier-1 Instant Snapshot Builder
 * 
 * Generates deterministic estimates without any API calls.
 * Used when no snapshot exists to provide instant UI feedback.
 */

export interface Tier1Snapshot {
  keyword: string;
  product_count: number;
  average_price: number;
  average_bsr: number | null;
  total_monthly_units: number;
  total_monthly_revenue: number;
  demand_level: 'high' | 'medium' | 'low' | 'very_low';
  last_updated: string;
  source: 'tier1';
}

export function buildTier1Snapshot(keyword: string): Tier1Snapshot {
  const productCount = 48;

  // Heuristic price bands
  const avgPrice =
    keyword.length <= 10 ? 22 :
    keyword.length <= 18 ? 26 :
    30;

  // Conservative velocity model
  const unitsPerPosition = [
    ...Array(10).fill(500),   // top 10
    ...Array(10).fill(200),   // mid
    ...Array(28).fill(50),    // bottom
  ];

  const totalUnits = unitsPerPosition.reduce((a, b) => a + b, 0);
  const totalRevenue = totalUnits * avgPrice;

  return {
    keyword: keyword.toLowerCase().trim(),
    product_count: productCount,
    average_price: avgPrice,
    average_bsr: 15000,
    total_monthly_units: totalUnits,
    total_monthly_revenue: Math.round(totalRevenue * 100) / 100,
    demand_level: totalUnits > 8000 ? "high" : "medium",
    last_updated: new Date().toISOString(),
    source: 'tier1' as const,
  };
}

/**
 * Convert Tier-1 snapshot to database format
 * Includes min/max estimates using deterministic logic:
 * - est_units_per_listing = 150
 * - total_units = page1_count * 150
 * - units_min = total_units * 0.7
 * - units_max = total_units * 1.3
 * - revenue_min = units_min * avg_price
 * - revenue_max = units_max * avg_price
 */
export function tier1ToDbFormat(snapshot: Tier1Snapshot, marketplace: string = 'amazon.com') {
  // Use specified deterministic logic for min/max calculation
  const estUnitsPerListing = 150;
  const page1Count = snapshot.product_count;
  const totalUnits = page1Count * estUnitsPerListing;
  const unitsMin = Math.round(totalUnits * 0.7);
  const unitsMax = Math.round(totalUnits * 1.3);
  const revenueMin = Math.round((unitsMin * snapshot.average_price) * 100) / 100;
  const revenueMax = Math.round((unitsMax * snapshot.average_price) * 100) / 100;

  return {
    keyword: snapshot.keyword,
    marketplace,
    product_count: snapshot.product_count,
    average_price: snapshot.average_price,
    average_bsr: snapshot.average_bsr,
    total_monthly_units: totalUnits, // Use calculated total
    total_monthly_revenue: revenueMin, // Use min as base (will be updated when min/max columns exist)
    demand_level: snapshot.demand_level,
    last_updated: snapshot.last_updated,
    // Store min/max values (will be added to schema if columns exist, otherwise ignored)
    est_total_monthly_units_min: unitsMin,
    est_total_monthly_units_max: unitsMax,
    est_total_monthly_revenue_min: revenueMin,
    est_total_monthly_revenue_max: revenueMax,
  };
}

