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
 */
export async function checkCreditBalance(
  userId: string,
  supabase: any,
  analysisRunId?: string
): Promise<{
  available_credits: number;
  session_credits_used: number;
  daily_credits_used: number;
}> {
  // TODO: Implement when user_credits table is created
  // For now, return default values
  // This will be implemented in Step 5 (database setup)
  
  // Placeholder implementation:
  // 1. Query user_credits table for available credits
  // 2. Query credit_usage_log for session usage (filter by analysisRunId)
  // 3. Query credit_usage_log for daily usage (last 24 hours)
  
  return {
    available_credits: 10, // Default: 10 free credits
    session_credits_used: 0,
    daily_credits_used: 0,
  };
}

/**
 * Check if ASIN data is cached
 */
export async function checkCacheForAsins(
  asins: string[],
  supabase: any
): Promise<Map<string, any>> {
  // TODO: Implement cache lookup
  // Check asin_product_cache table (to be created)
  // Return cached data if available
  
  const cached = new Map<string, any>();
  
  // Placeholder: will be implemented with actual cache table
  return cached;
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
 */
export async function cacheProductDetails(
  asin: string,
  productData: any,
  supabase: any
): Promise<void> {
  // TODO: Implement cache storage
  // Store in asin_product_cache table (to be created)
  // This will be implemented in Step 5 (database setup)
}

/**
 * Deduct credits from user account
 */
export async function deductCredits(
  userId: string,
  credits: number,
  asins: string[],
  analysisRunId: string,
  supabase: any
): Promise<void> {
  // TODO: Implement credit deduction
  // Update user_credits table
  // Log to credit_usage_log table
  // This will be implemented in Step 5 (database setup)
  
  console.log(`[CREDIT_DEDUCTION] User ${userId} used ${credits} credits for ASINs: ${asins.join(", ")}`);
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
  
  // Fetch missing data
  for (let i = 0; i < decision.required_asins.length; i++) {
    const asin = decision.required_asins[i];
    
    if (cachedData.has(asin)) {
      // Use cached data (no credit cost)
      productData.set(asin, cachedData.get(asin));
      cached[i] = true;
    } else {
      // Fetch from API (1 credit)
      try {
        const data = await fetchProductDetails(asin, rainforestApiKey);
        productData.set(asin, data);
        cached[i] = false;
        creditsUsed += 1;
        
        // Cache for future use
        await cacheProductDetails(asin, data, supabase);
      } catch (error) {
        console.error(`[ESCALATION_ERROR] Failed to fetch ${asin}:`, error);
        throw error;
      }
    }
  }
  
  // Deduct credits if any were used
  if (creditsUsed > 0) {
    await deductCredits(userId, creditsUsed, decision.required_asins, analysisRunId, supabase);
  }
  
  return {
    success: true,
    productData,
    creditsUsed,
    cached,
  };
}

