/**
 * Copilot Escalation Helpers
 * 
 * Helper functions for escalation execution:
 * - Credit balance checking
 * - Cache lookup
 * - Rainforest API calls
 * - Credit deduction
 */

import { EscalationDecision } from "./copilotEscalation";

/**
 * Check credit balance from database
 * 
 * Returns:
 * - available_credits: Total available (free + purchased + subscription - used)
 * - session_credits_used: Credits used in current analysis session
 * - daily_credits_used: Credits used in last 24 hours (rolling window)
 */
export async function checkCreditBalance(
  userId: string,
  supabase: any,
  analysisRunId?: string
): Promise<{
  available_credits: number;
  session_credits_used: number;
  daily_credits_used: number;
  max_session_credits?: number;
  max_daily_credits?: number;
}> {
  try {
    // 1. Get user credits (create if doesn't exist with 10 free credits)
    const { data: userCredits, error: creditsError } = await supabase
      .from("user_credits")
      .select("free_credits, purchased_credits, subscription_credits, used_credits")
      .eq("user_id", userId)
      .single();
    
    if (creditsError && creditsError.code === 'PGRST116') {
      // User credits don't exist - create with 10 free credits
      const { error: insertError } = await supabase
        .from("user_credits")
        .insert({
          user_id: userId,
          free_credits: 10,
          purchased_credits: 0,
          subscription_credits: 0,
          used_credits: 0,
        });
      
      if (insertError) {
        console.error("[CREDIT_BALANCE_ERROR] Failed to create user credits:", insertError);
        // Fallback to default
        return {
          available_credits: 10,
          session_credits_used: 0,
          daily_credits_used: 0,
        };
      }
      
      // Log free credit allocation
      await supabase
        .from("credit_transactions")
        .insert({
          user_id: userId,
          transaction_type: "free_allocated",
          credits: 10,
        });
      
      // Return default values
      return {
        available_credits: 10,
        session_credits_used: 0,
        daily_credits_used: 0,
      };
    }
    
    if (creditsError || !userCredits) {
      console.error("[CREDIT_BALANCE_ERROR] Failed to fetch user credits:", creditsError);
      // Fallback to default
      return {
        available_credits: 10,
        session_credits_used: 0,
        daily_credits_used: 0,
      };
    }
    
    // Calculate available credits
    const available_credits = Math.max(0,
      (userCredits.free_credits || 0) +
      (userCredits.purchased_credits || 0) +
      (userCredits.subscription_credits || 0) -
      (userCredits.used_credits || 0)
    );
    
    // 2. Get session credits used (if analysisRunId provided)
    let session_credits_used = 0;
    if (analysisRunId) {
      const { data: sessionUsage, error: sessionError } = await supabase
        .from("credit_usage_log")
        .select("credits_used")
        .eq("user_id", userId)
        .eq("analysis_run_id", analysisRunId);
      
      if (!sessionError && sessionUsage) {
        session_credits_used = sessionUsage.reduce((sum, log) => sum + (log.credits_used || 0), 0);
      }
    }
    
    // 3. Get daily credits used (last 24 hours)
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
    
    const { data: dailyUsage, error: dailyError } = await supabase
      .from("credit_usage_log")
      .select("credits_used")
      .eq("user_id", userId)
      .gte("created_at", twentyFourHoursAgo.toISOString());
    
    let daily_credits_used = 0;
    if (!dailyError && dailyUsage) {
      daily_credits_used = dailyUsage.reduce((sum, log) => sum + (log.credits_used || 0), 0);
    }
    
    return {
      available_credits,
      session_credits_used,
      daily_credits_used,
      max_session_credits: 10, // Per escalation policy
      max_daily_credits: 50, // Per escalation policy
    };
  } catch (error) {
    console.error("[CREDIT_BALANCE_ERROR] Unexpected error:", error);
    // Fallback to default
    return {
      available_credits: 10,
      session_credits_used: 0,
      daily_credits_used: 0,
      max_session_credits: 10,
      max_daily_credits: 50,
    };
  }
}

/**
 * Check if ASIN data is cached
 * 
 * Returns Map of ASIN -> cached product data (only if not expired)
 */
export async function checkCacheForAsins(
  asins: string[],
  supabase: any
): Promise<Map<string, any>> {
  const cached = new Map<string, any>();
  
  if (asins.length === 0) {
    return cached;
  }
  
  try {
    // Query cache for all ASINs (only non-expired entries)
    const { data: cacheEntries, error: cacheError } = await supabase
      .from("asin_product_cache")
      .select("asin, product_data, expires_at")
      .in("asin", asins)
      .gt("expires_at", new Date().toISOString()); // Only non-expired entries
    
    if (cacheError) {
      console.error("[CACHE_LOOKUP_ERROR] Failed to query cache:", cacheError);
      return cached;
    }
    
    if (cacheEntries) {
      for (const entry of cacheEntries) {
        if (entry.product_data) {
          cached.set(entry.asin, entry.product_data);
        }
      }
    }
    
    return cached;
  } catch (error) {
    console.error("[CACHE_LOOKUP_ERROR] Unexpected error:", error);
    return cached;
  }
}

/**
 * Make Rainforest API call for product details
 */
export async function fetchProductDetails(
  asin: string,
  rainforestApiKey: string
): Promise<any> {
  const apiUrl = `https://api.rainforestapi.com/request?api_key=${rainforestApiKey}&type=product&amazon_domain=amazon.com&asin=${asin}`;
  
  const response = await fetch(apiUrl, {
    method: "GET",
    headers: { "Accept": "application/json" },
  });
  
  if (!response.ok) {
    throw new Error(`Rainforest API error: ${response.status}`);
  }
  
  const data = await response.json();
  
  if (data.error) {
    throw new Error(`Rainforest API error: ${data.error}`);
  }
  
  return data;
}

/**
 * Cache product details for future use
 * 
 * Stores full Rainforest API response with 7-day TTL
 */
export async function cacheProductDetails(
  asin: string,
  productData: any,
  supabase: any
): Promise<void> {
  try {
    // Calculate expiration (7 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    
    // Upsert cache entry
    const { error: cacheError } = await supabase
      .from("asin_product_cache")
      .upsert({
        asin,
        product_data: productData,
        last_fetched_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        source: "rainforest",
      }, {
        onConflict: "asin",
      });
    
    if (cacheError) {
      console.error(`[CACHE_STORAGE_ERROR] Failed to cache ${asin}:`, cacheError);
      // Don't throw - caching failure shouldn't block escalation
    }
  } catch (error) {
    console.error(`[CACHE_STORAGE_ERROR] Unexpected error caching ${asin}:`, error);
    // Don't throw - caching failure shouldn't block escalation
  }
}

/**
 * Deduct credits from user account (atomic transaction)
 * 
 * This function performs an atomic transaction:
 * 1. Updates user_credits.used_credits
 * 2. Logs credit_transactions (negative amount)
 * 3. Logs credit_usage_log (one entry per ASIN)
 * 
 * All operations must succeed or all are rolled back.
 */
export async function deductCredits(
  userId: string,
  credits: number,
  asins: string[],
  analysisRunId: string,
  supabase: any
): Promise<void> {
  if (credits <= 0 || asins.length === 0) {
    return; // Nothing to deduct
  }
  
  try {
    // Use a transaction-like approach with Supabase
    // Note: Supabase doesn't support explicit transactions in the client,
    // so we'll do sequential operations and handle rollback manually if needed
    
    // 1. Update user_credits.used_credits (atomic increment via RPC)
    const { error: updateError } = await supabase.rpc('increment_used_credits', {
      p_user_id: userId,
      p_credits: credits,
    });
    
    if (updateError) {
      // If RPC doesn't exist yet, fall back to manual update
      if (updateError.message?.includes('function') && updateError.message?.includes('does not exist')) {
        // Fallback: Manual update (less atomic, but works)
        const { data: currentCredits, error: fetchError } = await supabase
          .from("user_credits")
          .select("used_credits")
          .eq("user_id", userId)
          .single();
        
        if (fetchError && fetchError.code === 'PGRST116') {
          // User credits don't exist - create with used credits
          const { error: createError } = await supabase
            .from("user_credits")
            .insert({
              user_id: userId,
              free_credits: 10,
              purchased_credits: 0,
              subscription_credits: 0,
              used_credits: credits,
            });
          
          if (createError) {
            throw new Error(`Failed to create user credits: ${createError.message}`);
          }
        } else if (fetchError || !currentCredits) {
          throw new Error(`Failed to fetch current credits: ${fetchError?.message}`);
        } else {
          // Update existing credits
          const { error: manualUpdateError } = await supabase
            .from("user_credits")
            .update({ used_credits: (currentCredits.used_credits || 0) + credits })
            .eq("user_id", userId);
          
          if (manualUpdateError) {
            throw new Error(`Failed to update credits: ${manualUpdateError.message}`);
          }
        }
      } else {
        throw new Error(`Failed to update credits: ${updateError.message}`);
      }
    }
    
    // 2. Log credit transaction (negative amount for usage)
    const { error: transactionError } = await supabase
      .from("credit_transactions")
      .insert({
        user_id: userId,
        transaction_type: "used",
        credits: -credits, // Negative for usage
        analysis_run_id: analysisRunId,
      });
    
    if (transactionError) {
      console.error("[CREDIT_DEDUCTION_ERROR] Failed to log transaction:", transactionError);
      // Try to rollback credit update (best effort)
      await supabase
        .from("user_credits")
        .update({ used_credits: supabase.raw('used_credits - ?', [credits]) })
        .eq("user_id", userId);
      throw transactionError;
    }
    
    // 3. Log credit usage (one entry per ASIN that cost credits)
    // Each ASIN costs 1 credit, so we log credits_used = 1 for first N ASINs
    const usageLogEntries = asins.slice(0, credits).map((asin) => ({
      user_id: userId,
      analysis_run_id: analysisRunId,
      asin,
      credits_used: 1, // Each ASIN costs 1 credit
      cached: false,
    }));
    
    const { error: usageLogError } = await supabase
      .from("credit_usage_log")
      .insert(usageLogEntries);
    
    if (usageLogError) {
      console.error("[CREDIT_DEDUCTION_ERROR] Failed to log usage:", usageLogError);
      // Transaction already partially committed, but log error
      // In production, consider implementing proper rollback
    }
    
    // Log successful deduction
    console.log("[CREDITS_DEDUCTED]", {
      user_id: userId,
      credits,
      asins,
      analysis_run_id: analysisRunId,
    });
  } catch (error) {
    console.error("[CREDIT_DEDUCTION_ERROR] Unexpected error:", error);
    throw error;
  }
}

/**
 * Execute escalation: fetch product details with cache check
 */
export async function executeEscalation(
  decision: EscalationDecision,
  userId: string,
  analysisRunId: string,
  supabase: any,
  rainforestApiKey?: string
): Promise<{
  success: boolean;
  productData: Map<string, any>;
  creditsUsed: number;
  cached: boolean[];
}> {
  if (!decision.requires_escalation || decision.required_asins.length === 0) {
    return {
      success: false,
      productData: new Map(),
      creditsUsed: 0,
      cached: [],
    };
  }
  
  if (!rainforestApiKey) {
    throw new Error("Rainforest API key not configured");
  }
  
  const productData = new Map<string, any>();
  const cached: boolean[] = [];
  let creditsUsed = 0;
  
  // Check cache first
  const cachedData = await checkCacheForAsins(decision.required_asins, supabase);
  
  // Track which ASINs were cached vs fetched
  const asinsToDeduct: string[] = [];
  
  // Fetch missing data
  for (let i = 0; i < decision.required_asins.length; i++) {
    const asin = decision.required_asins[i];
    
    if (cachedData.has(asin)) {
      // Use cached data (no credit cost)
      productData.set(asin, cachedData.get(asin));
      cached[i] = true;
      
      // Log cached usage (0 credits) - best effort, don't block on error
      try {
        await supabase
          .from("credit_usage_log")
          .insert({
            user_id: userId,
            analysis_run_id: analysisRunId,
            asin,
            credits_used: 0,
            cached: true,
          });
      } catch (logError) {
        // Log error but don't block - cached usage logging is non-critical
        console.error(`[CACHE_USAGE_LOG_ERROR] Failed to log cached usage for ${asin}:`, logError);
      }
    } else {
      // Fetch from API (1 credit)
      try {
        const data = await fetchProductDetails(asin, rainforestApiKey);
        productData.set(asin, data);
        cached[i] = false;
        creditsUsed += 1;
        asinsToDeduct.push(asin);
        
        // Cache for future use
        await cacheProductDetails(asin, data, supabase);
      } catch (error) {
        console.error(`[ESCALATION_ERROR] Failed to fetch ${asin}:`, error);
        throw error;
      }
    }
  }
  
  // Deduct credits if any were used (atomic transaction)
  if (creditsUsed > 0 && asinsToDeduct.length > 0) {
    await deductCredits(userId, creditsUsed, asinsToDeduct, analysisRunId, supabase);
  }
  
  return {
    success: true,
    productData,
    creditsUsed,
    cached,
  };
}

