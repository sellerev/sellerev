import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Deterministic Tier-1 heuristic for keyword market estimates
 * Uses: page-1 count × avg price × assumed velocity
 */
function calculateTier1Estimate(keyword: string): {
  product_count: number;
  average_price: number;
  total_monthly_units: number;
  total_monthly_revenue: number;
  demand_level: 'high' | 'medium' | 'low' | 'very_low';
} {
  // Standard Page 1 has ~48 products (Amazon shows up to 48 per page)
  const page1Count = 48;
  
  // Conservative average price estimate based on keyword length/complexity
  // Shorter keywords = more competitive = lower prices
  const keywordLength = keyword.length;
  const basePrice = keywordLength < 10 ? 15.00 : keywordLength < 20 ? 25.00 : 35.00;
  const averagePrice = basePrice;
  
  // Assumed velocity: conservative estimate of units per product per month
  // Position 1-10: ~500 units/month, Position 11-20: ~200 units/month, Position 21-48: ~50 units/month
  const top10Units = 10 * 500; // 5,000 units
  const mid10Units = 10 * 200; // 2,000 units
  const bottom28Units = 28 * 50; // 1,400 units
  const totalMonthlyUnits = top10Units + mid10Units + bottom28Units; // ~8,400 units
  
  // Total revenue = units × average price
  const totalMonthlyRevenue = totalMonthlyUnits * averagePrice;
  
  // Demand level based on estimated units
  let demandLevel: 'high' | 'medium' | 'low' | 'very_low';
  if (totalMonthlyUnits >= 10000) {
    demandLevel = 'high';
  } else if (totalMonthlyUnits >= 5000) {
    demandLevel = 'medium';
  } else if (totalMonthlyUnits >= 2000) {
    demandLevel = 'low';
  } else {
    demandLevel = 'very_low';
  }
  
  return {
    product_count: page1Count,
    average_price: averagePrice,
    total_monthly_units: totalMonthlyUnits,
    total_monthly_revenue: Math.round(totalMonthlyRevenue * 100) / 100, // Round to 2 decimals
    demand_level: demandLevel,
  };
}

Deno.serve(async (req) => {
  try {
    const { keyword } = await req.json();

    if (!keyword) {
      return new Response(JSON.stringify({ success: false, error: "Missing keyword" }), { 
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Normalize keyword (lowercase, trim) to match searchKeywordSnapshot logic
    const normalizedKeyword = keyword.toLowerCase().trim();

    // Calculate Tier-1 estimate using deterministic heuristic
    const estimate = calculateTier1Estimate(normalizedKeyword);

    console.log(`📊 Calculating Tier-1 estimate for: ${normalizedKeyword}`, estimate);

    // Upsert snapshot - CRITICAL: Must succeed or return error
    const { data: upsertedData, error: upsertError } = await supabase
      .from("keyword_snapshots")
      .upsert({
        keyword: normalizedKeyword,
        marketplace: "amazon.com",
        product_count: estimate.product_count,
        average_price: estimate.average_price,
        average_bsr: null, // Tier-1 doesn't have BSR data
        total_monthly_units: estimate.total_monthly_units,
        total_monthly_revenue: estimate.total_monthly_revenue,
        demand_level: estimate.demand_level,
        last_updated: new Date().toISOString()
      }, {
        onConflict: 'keyword,marketplace'
      })
      .select();

    if (upsertError) {
      console.error("❌ Failed to upsert snapshot:", upsertError);
      return new Response(JSON.stringify({ 
        success: false, 
        error: upsertError.message,
        details: upsertError 
      }), { 
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Verify snapshot was actually written by reading it back
    const { data: verifyData, error: verifyError } = await supabase
      .from("keyword_snapshots")
      .select("*")
      .eq("keyword", normalizedKeyword)
      .eq("marketplace", "amazon.com")
      .single();

    if (verifyError || !verifyData) {
      console.error("❌ Snapshot write verification failed:", verifyError);
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Snapshot write verification failed",
        details: verifyError?.message || "Snapshot not found after write"
      }), { 
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    console.log(`✅ Snapshot verified for keyword: ${normalizedKeyword}`, {
      total_monthly_units: verifyData.total_monthly_units,
      total_monthly_revenue: verifyData.total_monthly_revenue,
    });

    // Return success ONLY if snapshot was written and verified
    return new Response(JSON.stringify({ 
      success: true, 
      keyword: normalizedKeyword,
      snapshot: {
        total_monthly_units: verifyData.total_monthly_units,
        total_monthly_revenue: verifyData.total_monthly_revenue,
        product_count: verifyData.product_count,
        average_price: verifyData.average_price,
      }
    }), { 
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("❌ process-keyword error:", err);
    return new Response(JSON.stringify({ 
      success: false,
      error: err instanceof Error ? err.message : String(err) 
    }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
