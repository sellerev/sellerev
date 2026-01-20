/**
 * Keyword Snapshots Service
 * 
 * Precomputed market snapshots for cost-stable scaling.
 * User searches are pure database reads - no API calls.
 */

export interface KeywordSnapshot {
  keyword: string;
  marketplace: string;
  total_monthly_units: number;
  total_monthly_revenue: number;
  average_bsr: number | null;
  average_price: number | null;
  product_count: number;
  demand_level: 'high' | 'medium' | 'low' | 'very_low';
  last_updated: string;
  refresh_priority: number;
  search_count: number;
  // Min/max fields for Tier-1 estimates (added in migration 20250129)
  est_total_monthly_units_min?: number | null;
  est_total_monthly_units_max?: number | null;
  est_total_monthly_revenue_min?: number | null;
  est_total_monthly_revenue_max?: number | null;
}

export interface KeywordProduct {
  keyword: string;
  asin: string;
  rank: number;
  price: number | null;
  main_category: string | null;
  main_category_bsr: number | null;
  estimated_monthly_units: number | null;
  estimated_monthly_revenue: number | null;
  // Full product card rendering fields (from Rainforest SERP + SP-API)
  title: string | null;
  rating: number | null;
  review_count: number | null;
  image_url: string | null;
  brand: string | null;
  is_sponsored: boolean | null; // Sponsored status from Rainforest SERP (null = unknown)
  sponsored_position?: number | null; // Ad position from Rainforest (null if not sponsored, optional for backward compatibility)
  sponsored_source?: 'rainforest_serp' | 'organic_serp' | null; // Source of sponsored data (null if not stored, optional for backward compatibility)
  fulfillment: "FBA" | "FBM" | "AMZ" | null;
  // SP-API enrichment fields
  category: string | null; // Product category from SP-API
  bsr: number | null; // Best Seller Rank from SP-API
  last_enriched_at: string | null; // Timestamp when metadata was last enriched (7-day TTL)
  // SP-API Pricing fields
  buy_box_owner: "Amazon" | "Merchant" | "Unknown" | null; // Buy Box owner from SP-API Pricing API
  offer_count: number | null; // Total offer count from SP-API Pricing API
  // Source tagging (for debugging and UI badges)
  brand_source: 'sp_api' | 'rainforest' | 'inferred' | null;
  title_source: 'sp_api' | 'rainforest' | null;
  category_source: 'sp_api' | null;
  last_updated: string;
}

export interface QueueItem {
  id: string;
  keyword: string;
  marketplace: string;
  priority: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  requested_by: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  processing_started_at: string | null;
}

/**
 * Normalize keyword for consistent lookups
 */
export function normalizeKeyword(keyword: string): string {
  return keyword.toLowerCase().trim();
}

/**
 * Search for keyword snapshot (READ-ONLY, no API calls)
 * 
 * @param supabase - Supabase client
 * @param keyword - Search keyword
 * @param marketplace - Marketplace (default: 'amazon.com')
 * @returns Snapshot if exists, null otherwise
 */
export async function searchKeywordSnapshot(
  supabase: any,
  keyword: string,
  marketplace: string = 'amazon.com'
): Promise<KeywordSnapshot | null> {
  if (!supabase) return null;

  const normalized = normalizeKeyword(keyword);

  const { data, error } = await supabase
    .from('keyword_snapshots')
    .select('*')
    .eq('keyword', normalized)
    .eq('marketplace', marketplace)
    .single();

  if (error || !data) {
    return null;
  }

  return data as KeywordSnapshot;
}

/**
 * Build keyword snapshot from cached keyword_products
 * Rebuilds snapshot entirely from ASIN-level cache with zero Rainforest API calls
 * 
 * @param supabase - Supabase client
 * @param keyword - Search keyword
 * @param marketplace - Marketplace (default: 'amazon.com')
 * @returns Snapshot if products exist, null otherwise
 */
export async function buildKeywordSnapshotFromCache(
  supabase: any,
  keyword: string,
  marketplace: string = 'amazon.com'
): Promise<KeywordSnapshot | null> {
  if (!supabase) return null;

  const normalized = normalizeKeyword(keyword);
  const snapshotMarketplace = marketplace === 'US' ? 'amazon.com' : marketplace;
  
  // Check if snapshot exists and is fresh (< 24h)
  const { data: existingSnapshot, error: checkError } = await supabase
    .from('keyword_snapshots')
    .select('*')
    .eq('keyword', normalized)
    .eq('marketplace', snapshotMarketplace)
    .single();

  if (!checkError && existingSnapshot) {
    const lastUpdated = new Date(existingSnapshot.last_updated);
    const now = new Date();
    const ageHours = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60);
    
    if (ageHours < 24) {
      // Snapshot is fresh - reuse it
      return existingSnapshot as KeywordSnapshot;
    }
  }

  // Query keyword_products for this keyword
  const { data: products, error: productsError } = await supabase
    .from('keyword_products')
    .select('*')
    .eq('keyword', normalized);

  if (productsError || !products || products.length === 0) {
    return null;
  }

  // Aggregate data from products
  const productsWithUnits = products.filter((p: any) => p.estimated_monthly_units !== null && p.estimated_monthly_units !== undefined);
  const productsWithRevenue = products.filter((p: any) => p.estimated_monthly_revenue !== null && p.estimated_monthly_revenue !== undefined);
  const productsWithPrice = products.filter((p: any) => p.price !== null && p.price !== undefined && p.price > 0);

  const totalMonthlyUnits = productsWithUnits.reduce((sum: number, p: any) => sum + (p.estimated_monthly_units || 0), 0);
  const totalMonthlyRevenue = productsWithRevenue.reduce((sum: number, p: any) => sum + (parseFloat(p.estimated_monthly_revenue) || 0), 0);
  const averagePrice = productsWithPrice.length > 0
    ? productsWithPrice.reduce((sum: number, p: any) => sum + (parseFloat(p.price) || 0), 0) / productsWithPrice.length
    : null;
  const productCount = products.length;

  // Compute demand_level based on total units
  let demandLevel: 'high' | 'medium' | 'low' | 'very_low';
  if (totalMonthlyUnits >= 200000) {
    demandLevel = 'high';
  } else if (totalMonthlyUnits >= 50000) {
    demandLevel = 'medium';
  } else if (totalMonthlyUnits >= 10000) {
    demandLevel = 'low';
  } else {
    demandLevel = 'very_low';
  }

  // Build snapshot object
  const snapshot: Omit<KeywordSnapshot, 'created_at'> = {
    keyword: normalized,
    marketplace: snapshotMarketplace,
    total_monthly_units: totalMonthlyUnits,
    total_monthly_revenue: totalMonthlyRevenue,
    average_bsr: null, // Not computed from products
    average_price: averagePrice,
    product_count: productCount,
    demand_level: demandLevel,
    last_updated: new Date().toISOString(),
    refresh_priority: 5,
    search_count: existingSnapshot?.search_count || 0,
  };

  // UPSERT snapshot
  const { error: upsertError } = await supabase
    .from('keyword_snapshots')
    .upsert(snapshot, {
      onConflict: 'keyword,marketplace',
    });

  if (upsertError) {
    console.error('Failed to upsert snapshot from cache:', upsertError);
    return null;
  }

  console.log('KEYWORD_SNAPSHOT_FROM_CACHE', {
    keyword: normalized,
    product_count: productCount,
    total_units: totalMonthlyUnits,
    demand_level: demandLevel,
  });

  return snapshot as KeywordSnapshot;
}

/**
 * Get products for a keyword
 */
export async function getKeywordProducts(
  supabase: any,
  keyword: string,
  marketplace: string = 'amazon.com'
): Promise<KeywordProduct[]> {
  if (!supabase) return [];

  const normalized = normalizeKeyword(keyword);

  const { data, error } = await supabase
    .from('keyword_products')
    .select('*')
    .eq('keyword', normalized)
    .order('rank', { ascending: true });

  if (error || !data) {
    return [];
  }

  return data as KeywordProduct[];
}

/**
 * Increment search count for a keyword
 */
export async function incrementSearchCount(
  supabase: any,
  keyword: string,
  marketplace: string = 'amazon.com'
): Promise<void> {
  if (!supabase) return;

  const normalized = normalizeKeyword(keyword);

  // Get current count and increment
  const { data } = await supabase
    .from('keyword_snapshots')
    .select('search_count')
    .eq('keyword', normalized)
    .eq('marketplace', marketplace)
    .single();

  if (data) {
    await supabase
      .from('keyword_snapshots')
      .update({ search_count: (data.search_count || 0) + 1 })
      .eq('keyword', normalized)
      .eq('marketplace', marketplace);
  }
}

/**
 * Queue a keyword for processing
 * 
 * @param supabase - Supabase client
 * @param keyword - Keyword to queue
 * @param priority - Priority (1-10, default: 5)
 * @param requestedBy - User ID who requested (optional)
 * @param marketplace - Marketplace (default: 'amazon.com')
 * @returns Queue item ID
 */
export async function queueKeyword(
  supabase: any,
  keyword: string,
  priority: number = 5,
  requestedBy: string | null = null,
  marketplace: string = 'amazon.com'
): Promise<string | null> {
  if (!supabase) return null;

  const normalized = normalizeKeyword(keyword);

  // Check if already queued (pending or processing)
  // CRITICAL: Select both 'id' and 'priority' to read full row for priority comparison
  const { data: existing } = await supabase
    .from('keyword_queue')
    .select('id, priority')
    .eq('keyword', normalized)
    .eq('marketplace', marketplace)
    .in('status', ['pending', 'processing'])
    .single();

  if (existing) {
    // Update priority if higher (now we have existing.priority from the select)
    await supabase
      .from('keyword_queue')
      .update({ priority: Math.max(priority, existing.priority || 0) })
      .eq('id', existing.id);
    return existing.id;
  }

  const { data, error } = await supabase
    .from('keyword_queue')
    .insert({
      keyword: normalized,
      marketplace,
      priority: Math.max(1, Math.min(10, priority)),
      status: 'pending',
      requested_by: requestedBy,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('Failed to queue keyword:', error);
    return null;
  }

  return data.id;
}

/**
 * Get pending queue items (for background worker)
 */
export async function getPendingQueueItems(
  supabase: any,
  limit: number = 10
): Promise<QueueItem[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('keyword_queue')
    .select('*')
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return data as QueueItem[];
}

/**
 * Mark queue item as processing
 */
export async function markQueueProcessing(
  supabase: any,
  queueId: string
): Promise<boolean> {
  if (!supabase) return false;

  const { error } = await supabase
    .from('keyword_queue')
    .update({
      status: 'processing',
      processing_started_at: new Date().toISOString(),
    })
    .eq('id', queueId)
    .eq('status', 'pending'); // Only update if still pending

  return !error;
}

/**
 * Mark queue item as completed
 */
export async function markQueueCompleted(
  supabase: any,
  queueId: string
): Promise<boolean> {
  if (!supabase) return false;

  const { error } = await supabase
    .from('keyword_queue')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', queueId);

  return !error;
}

/**
 * Mark queue item as failed
 */
export async function markQueueFailed(
  supabase: any,
  queueId: string,
  errorMessage: string
): Promise<boolean> {
  if (!supabase) return false;

  const { error } = await supabase
    .from('keyword_queue')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: errorMessage.substring(0, 500),
    })
    .eq('id', queueId);

  return !error;
}

/**
 * Save snapshot and products
 */
export async function saveKeywordSnapshot(
  supabase: any,
  snapshot: Omit<KeywordSnapshot, 'created_at'>,
  products: Omit<KeywordProduct, 'last_updated'>[]
): Promise<boolean> {
  if (!supabase) return false;

  try {
    // Upsert snapshot
    const { error: snapshotError } = await supabase
      .from('keyword_snapshots')
      .upsert({
        ...snapshot,
        last_updated: new Date().toISOString(),
      }, {
        onConflict: 'keyword,marketplace',
      });

    if (snapshotError) {
      console.error('Failed to save snapshot:', snapshotError);
      return false;
    }

    // Delete existing products for this keyword
    const { error: deleteError } = await supabase
      .from('keyword_products')
      .delete()
      .eq('keyword', snapshot.keyword)
      .eq('marketplace', snapshot.marketplace);

    if (deleteError) {
      console.error('Failed to delete existing products:', deleteError);
    }

    // Insert new products
    if (products.length > 0) {
      const productsWithTimestamp = products.map(p => ({
        ...p,
        last_updated: new Date().toISOString(),
      }));

      const { error: insertError } = await supabase
        .from('keyword_products')
        .insert(productsWithTimestamp);

      if (insertError) {
        console.error('Failed to insert products:', insertError);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('Error saving snapshot:', error);
    return false;
  }
}

/**
 * Check daily keyword processing limit
 * Returns count of keywords processed today
 */
export async function getDailyProcessingCount(
  supabase: any
): Promise<number> {
  if (!supabase) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('keyword_queue')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'completed')
    .gte('completed_at', today.toISOString());

  if (error) return 0;

  return data || 0;
}

