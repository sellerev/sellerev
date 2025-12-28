/**
 * Tier-2 Enrichment: Real data from Rainforest API
 * 
 * Replaces Tier-1 estimates with actual market data:
 * - Rainforest search (1 credit)
 * - Rainforest product batch (1 credit)
 * - BSR → Units → Revenue calculations
 */

import { fetchKeywordMarketSnapshot } from "@/lib/amazon/keywordMarket";

export interface Tier2Snapshot {
  keyword: string;
  product_count: number;
  average_price: number | null;
  average_bsr: number | null;
  total_monthly_units: number;
  total_monthly_revenue: number;
  demand_level: 'high' | 'medium' | 'low' | 'very_low';
  last_updated: string;
  source: 'tier2';
}

/**
 * Process keyword with Tier-2 enrichment using Rainforest API
 */
export async function processKeywordTier2(
  keyword: string,
  supabase: any,
  marketplace: string = 'amazon.com'
): Promise<{ success: boolean; snapshot?: Tier2Snapshot; error?: string }> {
  try {
    const normalizedKeyword = keyword.toLowerCase().trim();

    console.log(`🔄 Processing Tier-2 enrichment for: ${normalizedKeyword}`);

    // Fetch real market data from Rainforest
    const marketData = await fetchKeywordMarketSnapshot(normalizedKeyword, supabase, "US");

    if (!marketData || !marketData.snapshot) {
      return {
        success: false,
        error: "Failed to fetch market data from Rainforest",
      };
    }

    const { snapshot, listings } = marketData;

    // Calculate total monthly units and revenue from listings
    const listingsWithUnits = listings.filter(
      (l) => l.est_monthly_units !== null && l.est_monthly_units !== undefined
    );
    const totalMonthlyUnits = listingsWithUnits.reduce(
      (sum, l) => sum + (l.est_monthly_units || 0),
      0
    );

    const listingsWithRevenue = listings.filter(
      (l) => l.est_monthly_revenue !== null && l.est_monthly_revenue !== undefined
    );
    const totalMonthlyRevenue = listingsWithRevenue.reduce(
      (sum, l) => sum + (l.est_monthly_revenue || 0),
      0
    );

    // Determine demand level
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

    const tier2Snapshot: Tier2Snapshot = {
      keyword: normalizedKeyword,
      product_count: snapshot.total_page1_listings || listings.length,
      average_price: snapshot.avg_price,
      average_bsr: snapshot.avg_bsr,
      total_monthly_units: totalMonthlyUnits || 0,
      total_monthly_revenue: Math.round(totalMonthlyRevenue * 100) / 100,
      demand_level: demandLevel,
      last_updated: new Date().toISOString(),
      source: 'tier2',
    };

    // Save Tier-2 snapshot to database (overwrites Tier-1)
    const { error: upsertError } = await supabase
      .from("keyword_snapshots")
      .upsert({
        keyword: normalizedKeyword,
        marketplace,
        product_count: tier2Snapshot.product_count,
        average_price: tier2Snapshot.average_price,
        average_bsr: tier2Snapshot.average_bsr,
        total_monthly_units: tier2Snapshot.total_monthly_units,
        total_monthly_revenue: tier2Snapshot.total_monthly_revenue,
        demand_level: tier2Snapshot.demand_level,
        last_updated: tier2Snapshot.last_updated,
      }, {
        onConflict: 'keyword,marketplace'
      });

    if (upsertError) {
      console.error("❌ Failed to save Tier-2 snapshot:", upsertError);
      return {
        success: false,
        error: upsertError.message,
      };
    }

    // Save products to keyword_products table
    if (listings.length > 0) {
      const products = listings.map((listing, index) => ({
        keyword: normalizedKeyword,
        asin: listing.asin || '',
        rank: index + 1,
        price: listing.price,
        main_category: listing.main_category,
        main_category_bsr: listing.main_category_bsr,
        estimated_monthly_units: listing.est_monthly_units,
        estimated_monthly_revenue: listing.est_monthly_revenue,
        last_updated: new Date().toISOString(),
      })).filter(p => p.asin); // Only include listings with ASINs

      if (products.length > 0) {
        // Delete existing products
        await supabase
          .from("keyword_products")
          .delete()
          .eq("keyword", normalizedKeyword)
          .eq("marketplace", marketplace);

        // Insert new products
        const { error: productsError } = await supabase
          .from("keyword_products")
          .insert(products);

        if (productsError) {
          console.error("⚠️ Failed to save products:", productsError);
          // Don't fail the whole operation if products fail
        }
      }
    }

    console.log(`✅ Tier-2 snapshot saved:`, {
      keyword: normalizedKeyword,
      total_monthly_units: tier2Snapshot.total_monthly_units,
      total_monthly_revenue: tier2Snapshot.total_monthly_revenue,
      product_count: tier2Snapshot.product_count,
    });

    return {
      success: true,
      snapshot: tier2Snapshot,
    };
  } catch (error) {
    console.error("❌ Tier-2 enrichment error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

