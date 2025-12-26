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
  const { data: existing } = await supabase
    .from('keyword_queue')
    .select('id')
    .eq('keyword', normalized)
    .eq('marketplace', marketplace)
    .in('status', ['pending', 'processing'])
    .single();

  if (existing) {
    // Update priority if higher
    await supabase
      .from('keyword_queue')
      .update({ priority: Math.max(priority, existing.priority) })
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

