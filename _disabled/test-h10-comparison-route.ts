/**
 * API endpoint to compare Sellerev metrics with Helium 10 benchmarks
 * 
 * GET /api/test-h10-comparison
 * 
 * Returns comparison data for all 6 test keywords
 */

import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";
import { fetchKeywordMarketSnapshot } from "@/lib/amazon/keywordMarket";

// Helium 10 benchmark data
const H10_BENCHMARKS = {
  "Vacuum Storage Bags": {
    number_of_products: 49.00,
    average_price: 21.32,
    average_bsr: 98600.00,
    monthly_units: 682985.00,
    monthly_revenue: 15448035.00,
    average_rating: 4.50,
    search_volume: 45515.00,
  },
  "Resistance Bands": {
    number_of_products: 50.00,
    average_price: 24.21,
    average_bsr: 24586.00,
    monthly_units: 428799.00,
    monthly_revenue: 6932595.00,
    average_rating: 4.50,
    search_volume: 122514.00,
  },
  "Face Serum": {
    number_of_products: 48.00,
    average_price: 22.77,
    average_bsr: 6298.00,
    monthly_units: 1955995.00,
    monthly_revenue: 40673615.00,
    average_rating: 4.50,
    search_volume: 10216.00,
  },
  "Dog Poop Bags": {
    number_of_products: 49.00,
    average_price: 19.13,
    average_bsr: 9742.00,
    monthly_units: 1328219.00,
    monthly_revenue: 16818429.00,
    average_rating: 4.70,
    search_volume: 27379.00,
  },
  "Toy Storage Bin": {
    number_of_products: 49.00,
    average_price: 38.12,
    average_bsr: 15519.00,
    monthly_units: 373305.00,
    monthly_revenue: 14571461.00,
    average_rating: 4.50,
    search_volume: 973.00,
  },
  "Kitchen Scale": {
    number_of_products: 49.00,
    average_price: 25.25,
    average_bsr: 46186.00,
    monthly_units: 738175.00,
    monthly_revenue: 13028843.00,
    average_rating: 4.60,
    search_volume: 61396.00,
  },
};

interface ComparisonResult {
  keyword: string;
  metric: string;
  h10_value: number;
  sellerev_value: number | null;
  difference: number | null;
  difference_pct: number | null;
  status: "match" | "close" | "far" | "missing";
}

/**
 * Parse search volume range string to midpoint
 */
function parseSearchVolumeMidpoint(rangeStr: string | null | undefined): number | null {
  if (!rangeStr) return null;
  
  const match = rangeStr.match(/(\d+(?:\.\d+)?)([kM]?)\s*[–-]\s*(\d+(?:\.\d+)?)([kM]?)/);
  if (match) {
    const min = parseFloat(match[1]) * (match[2] === 'M' ? 1000000 : match[2] === 'k' ? 1000 : 1);
    const max = parseFloat(match[3]) * (match[4] === 'M' ? 1000000 : match[4] === 'k' ? 1000 : 1);
    return Math.round((min + max) / 2);
  }
  
  const singleMatch = rangeStr.match(/(\d+(?:\.\d+)?)([kM]?)/);
  if (singleMatch) {
    return Math.round(parseFloat(singleMatch[1]) * (singleMatch[2] === 'M' ? 1000000 : singleMatch[2] === 'k' ? 1000 : 1));
  }
  
  return null;
}

function classifyDifference(h10Value: number, sellerevValue: number | null): ComparisonResult["status"] {
  if (sellerevValue === null) return "missing";
  const diffPct = Math.abs((sellerevValue - h10Value) / h10Value) * 100;
  if (diffPct < 5) return "match";
  if (diffPct < 20) return "close";
  return "far";
}

function compareMetric(
  keyword: string,
  metricName: string,
  h10Value: number,
  sellerevValue: number | null
): ComparisonResult {
  const difference = sellerevValue !== null ? sellerevValue - h10Value : null;
  const differencePct = sellerevValue !== null && h10Value !== 0 
    ? ((sellerevValue - h10Value) / h10Value) * 100 
    : null;
  
  return {
    keyword,
    metric: metricName,
    h10_value: h10Value,
    sellerev_value: sellerevValue,
    difference,
    difference_pct: differencePct,
    status: classifyDifference(h10Value, sellerevValue),
  };
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createApiClient();
    const allComparisons: ComparisonResult[] = [];
    const results: Record<string, any> = {};
    
    // Analyze each keyword
    for (const [keyword, h10Data] of Object.entries(H10_BENCHMARKS)) {
      console.log(`Analyzing: ${keyword}`);
      
      const marketData = await fetchKeywordMarketSnapshot(keyword, supabase, "US");
      
      if (!marketData) {
        console.error(`Failed to fetch data for: ${keyword}`);
        results[keyword] = { error: "Failed to fetch market data" };
        continue;
      }
      
      const { snapshot, listings } = marketData;
      
      // Extract our metrics
      const ourMetrics = {
        number_of_products: snapshot.total_page1_listings || 0,
        average_price: snapshot.avg_price || null,
        average_bsr: snapshot.avg_bsr || null,
        monthly_units: snapshot.est_total_monthly_units_min || null,
        monthly_revenue: snapshot.est_total_monthly_revenue_min || null,
        average_rating: snapshot.avg_rating || null,
        search_volume: parseSearchVolumeMidpoint(snapshot.search_demand?.search_volume_range) || null,
      };
      
      // Calculate from individual listings if aggregate is missing
      if (ourMetrics.monthly_units === null && listings.length > 0) {
        const totalUnits = listings
          .map(l => l.est_monthly_units)
          .filter((u): u is number => u !== null && u !== undefined)
          .reduce((sum, u) => sum + u, 0);
        if (totalUnits > 0) ourMetrics.monthly_units = totalUnits;
      }
      
      if (ourMetrics.monthly_revenue === null && listings.length > 0) {
        const totalRevenue = listings
          .map(l => l.est_monthly_revenue)
          .filter((r): r is number => r !== null && r !== undefined)
          .reduce((sum, r) => sum + r, 0);
        if (totalRevenue > 0) ourMetrics.monthly_revenue = totalRevenue;
      }
      
      // Compare each metric
      const comparisons: ComparisonResult[] = [];
      for (const [metricKey, h10Value] of Object.entries(h10Data)) {
        const ourValue = ourMetrics[metricKey as keyof typeof ourMetrics];
        comparisons.push(compareMetric(keyword, metricKey, h10Value, ourValue || null));
      }
      
      allComparisons.push(...comparisons);
      results[keyword] = {
        our_metrics: ourMetrics,
        h10_benchmarks: h10Data,
        comparisons,
      };
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Generate summary
    const summary: Record<string, { match: number; close: number; far: number; missing: number; total: number }> = {};
    const metrics = ["number_of_products", "average_price", "average_bsr", "monthly_units", "monthly_revenue", "average_rating", "search_volume"];
    
    for (const metric of metrics) {
      const metricComparisons = allComparisons.filter(c => c.metric === metric);
      summary[metric] = {
        match: metricComparisons.filter(c => c.status === "match").length,
        close: metricComparisons.filter(c => c.status === "close").length,
        far: metricComparisons.filter(c => c.status === "far").length,
        missing: metricComparisons.filter(c => c.status === "missing").length,
        total: metricComparisons.length,
      };
    }
    
    return NextResponse.json({
      success: true,
      summary,
      results,
      all_comparisons: allComparisons,
    }, { status: 200 });
    
  } catch (error) {
    console.error("Error in H10 comparison:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

