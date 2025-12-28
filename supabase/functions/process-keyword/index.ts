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
    const { keyword, tier } = await req.json();

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

    const normalizedKeyword = keyword.toLowerCase().trim();
    const isTier2 = tier === 'tier2' || tier === 2;

    if (isTier2) {
      // Tier-2: Use Rainforest API for real data
      console.log(`🔄 Tier-2 enrichment for: ${normalizedKeyword}`);
      
      const rainforestApiKey = Deno.env.get("RAINFOREST_API_KEY");
      if (!rainforestApiKey) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: "RAINFOREST_API_KEY not configured" 
        }), { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }

      // Fetch search results from Rainforest
      const searchUrl = `https://api.rainforestapi.com/request?api_key=${rainforestApiKey}&type=search&amazon_domain=amazon.com&search_term=${encodeURIComponent(normalizedKeyword)}&page=1`;
      const searchResponse = await fetch(searchUrl);
      
      if (!searchResponse.ok) {
        const errorText = await searchResponse.text();
        console.error(`Rainforest search error: ${searchResponse.status}`, errorText.substring(0, 200));
        return new Response(JSON.stringify({ 
          success: false, 
          error: `Rainforest API error: ${searchResponse.status}` 
        }), { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }

      const searchData = await searchResponse.json();
      const results = searchData.search_results || searchData.results || searchData.organic_results || [];
      
      if (results.length === 0) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: "No search results returned" 
        }), { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }

      // Calculate metrics from real data
      const prices = results
        .map((r: any) => r.price?.value || r.price)
        .filter((p: any) => p && typeof p === 'number' && p > 0);
      const avgPrice = prices.length > 0 
        ? prices.reduce((a: number, b: number) => a + b, 0) / prices.length 
        : 25.00;

      // Estimate units from position (conservative)
      const unitsPerPosition = [
        ...Array(10).fill(500),
        ...Array(10).fill(200),
        ...Array(28).fill(50),
      ];
      const totalUnits = unitsPerPosition.slice(0, Math.min(results.length, 48))
        .reduce((a, b) => a + b, 0);
      const totalRevenue = totalUnits * avgPrice;

      const demandLevel = totalUnits > 8000 ? 'high' : totalUnits > 5000 ? 'medium' : 'low';

      // Save Tier-2 snapshot
      const { error: upsertError } = await supabase
        .from("keyword_snapshots")
        .upsert({
          keyword: normalizedKeyword,
          marketplace: "amazon.com",
          product_count: results.length,
          average_price: avgPrice,
          average_bsr: null, // Would need product API calls for BSR
          total_monthly_units: totalUnits,
          total_monthly_revenue: Math.round(totalRevenue * 100) / 100,
          demand_level: demandLevel,
          last_updated: new Date().toISOString()
        }, {
          onConflict: 'keyword,marketplace'
        });

      if (upsertError) {
        console.error("❌ Failed to save Tier-2 snapshot:", upsertError);
        return new Response(JSON.stringify({ 
          success: false, 
          error: upsertError.message 
        }), { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }

      console.log(`✅ Tier-2 snapshot saved: ${normalizedKeyword}`);
      return new Response(JSON.stringify({ 
        success: true, 
        keyword: normalizedKeyword,
        tier: 'tier2'
      }), { 
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    } else {
      // Tier-1: Deterministic heuristic (no API calls)
      const estimate = calculateTier1Estimate(normalizedKeyword);
      console.log(`📊 Tier-1 estimate for: ${normalizedKeyword}`, estimate);

      const { error: upsertError } = await supabase
        .from("keyword_snapshots")
        .upsert({
          keyword: normalizedKeyword,
          marketplace: "amazon.com",
          product_count: estimate.product_count,
          average_price: estimate.average_price,
          average_bsr: null,
          total_monthly_units: estimate.total_monthly_units,
          total_monthly_revenue: estimate.total_monthly_revenue,
          demand_level: estimate.demand_level,
          last_updated: new Date().toISOString()
        }, {
          onConflict: 'keyword,marketplace'
        });

      if (upsertError) {
        console.error("❌ Failed to upsert Tier-1 snapshot:", upsertError);
        return new Response(JSON.stringify({ 
          success: false, 
          error: upsertError.message 
        }), { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }

      // Verify snapshot
      const { data: verifyData, error: verifyError } = await supabase
        .from("keyword_snapshots")
        .select("*")
        .eq("keyword", normalizedKeyword)
        .eq("marketplace", "amazon.com")
        .single();

      if (verifyError || !verifyData) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: "Snapshot verification failed" 
        }), { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ 
        success: true, 
        keyword: normalizedKeyword,
        tier: 'tier1'
      }), { 
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
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
