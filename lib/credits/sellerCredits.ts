/**
 * Seller Credits Helper Functions
 * 
 * Simplified interface for credit management.
 * Uses existing user_credits table from Step 5.
 */

/**
 * Check if user can consume the specified amount of credits
 * 
 * @param userId - User ID
 * @param amount - Number of credits to check
 * @param supabase - Supabase client
 * @returns true if user has enough credits, false otherwise
 */
export async function canConsumeCredits(
  userId: string,
  amount: number,
  supabase: any
): Promise<boolean> {
  try {
    const { data: userCredits, error } = await supabase
      .from("user_credits")
      .select("free_credits, purchased_credits, subscription_credits, used_credits")
      .eq("user_id", userId)
      .single();
    
    if (error && error.code === 'PGRST116') {
      // User credits don't exist - create with 10 free credits
      await supabase
        .from("user_credits")
        .insert({
          user_id: userId,
          free_credits: 10,
          purchased_credits: 0,
          subscription_credits: 0,
          used_credits: 0,
        });
      
      // New user gets 10 free credits
      return amount <= 10;
    }
    
    if (error || !userCredits) {
      console.error("[CAN_CONSUME_CREDITS_ERROR]", error);
      return false;
    }
    
    const availableCredits = 
      (userCredits.free_credits || 0) +
      (userCredits.purchased_credits || 0) +
      (userCredits.subscription_credits || 0) -
      (userCredits.used_credits || 0);
    
    return availableCredits >= amount;
  } catch (error) {
    console.error("[CAN_CONSUME_CREDITS_ERROR] Unexpected error:", error);
    return false;
  }
}

/**
 * Consume credits for a user
 * 
 * @param userId - User ID
 * @param amount - Number of credits to consume
 * @param reason - Reason for consumption (e.g., "copilot_escalation")
 * @param metadata - Additional metadata (e.g., { asins: ["B0XXX"], analysis_run_id: "..." })
 * @param supabase - Supabase client
 * @returns true if successful, false otherwise
 */
export async function consumeCredits(
  userId: string,
  amount: number,
  reason: string,
  metadata: {
    asins?: string[];
    analysis_run_id?: string;
    [key: string]: any;
  },
  supabase: any
): Promise<boolean> {
  if (amount <= 0) {
    return true; // Nothing to consume
  }
  
  try {
    // Check if user has enough credits
    const canConsume = await canConsumeCredits(userId, amount, supabase);
    if (!canConsume) {
      console.error("[CONSUME_CREDITS_ERROR] Insufficient credits", {
        userId,
        amount,
        reason,
      });
      return false;
    }
    
    // Increment used_credits atomically
    const { error: updateError } = await supabase.rpc('increment_used_credits', {
      p_user_id: userId,
      p_credits: amount,
    });
    
    // Fallback if RPC doesn't exist
    if (updateError && updateError.message?.includes('function') && updateError.message?.includes('does not exist')) {
      const { data: currentCredits, error: fetchError } = await supabase
        .from("user_credits")
        .select("used_credits")
        .eq("user_id", userId)
        .single();
      
      if (fetchError && fetchError.code === 'PGRST116') {
        // Create user credits
        const { error: createError } = await supabase
          .from("user_credits")
          .insert({
            user_id: userId,
            free_credits: 10,
            purchased_credits: 0,
            subscription_credits: 0,
            used_credits: amount,
          });
        
        if (createError) {
          console.error("[CONSUME_CREDITS_ERROR] Failed to create user credits:", createError);
          return false;
        }
      } else if (fetchError || !currentCredits) {
        console.error("[CONSUME_CREDITS_ERROR] Failed to fetch current credits:", fetchError);
        return false;
      } else {
        // Update existing credits
        const { error: manualUpdateError } = await supabase
          .from("user_credits")
          .update({ used_credits: (currentCredits.used_credits || 0) + amount })
          .eq("user_id", userId);
        
        if (manualUpdateError) {
          console.error("[CONSUME_CREDITS_ERROR] Failed to update credits:", manualUpdateError);
          return false;
        }
      }
    } else if (updateError) {
      console.error("[CONSUME_CREDITS_ERROR] Failed to update credits:", updateError);
      return false;
    }
    
    // Log transaction
    const { error: transactionError } = await supabase
      .from("credit_transactions")
      .insert({
        user_id: userId,
        transaction_type: "used",
        credits: -amount, // Negative for usage
        analysis_run_id: metadata.analysis_run_id || null,
      });
    
    if (transactionError) {
      console.error("[CONSUME_CREDITS_ERROR] Failed to log transaction:", transactionError);
      // Don't fail - transaction logging is non-critical
    }
    
    // Log usage (one entry per ASIN if provided)
    if (metadata.asins && metadata.asins.length > 0 && metadata.analysis_run_id) {
      const usageLogEntries = metadata.asins.slice(0, amount).map((asin) => ({
        user_id: userId,
        analysis_run_id: metadata.analysis_run_id,
        asin,
        credits_used: 1,
        cached: false,
      }));
      
      const { error: usageLogError } = await supabase
        .from("credit_usage_log")
        .insert(usageLogEntries);
      
      if (usageLogError) {
        console.error("[CONSUME_CREDITS_ERROR] Failed to log usage:", usageLogError);
        // Don't fail - usage logging is non-critical
      }
    }
    
    console.log("[CREDITS_CONSUMED]", {
      user_id: userId,
      amount,
      reason,
      metadata,
    });
    
    return true;
  } catch (error) {
    console.error("[CONSUME_CREDITS_ERROR] Unexpected error:", error);
    return false;
  }
}

/**
 * Get current credit balance for a user
 * 
 * @param userId - User ID
 * @param supabase - Supabase client
 * @returns Credit balance info
 */
export async function getCreditBalance(
  userId: string,
  supabase: any
): Promise<{
  credits_remaining: number;
  credits_used: number;
  last_updated_at: string | null;
}> {
  try {
    const { data: userCredits, error } = await supabase
      .from("user_credits")
      .select("free_credits, purchased_credits, subscription_credits, used_credits, updated_at")
      .eq("user_id", userId)
      .single();
    
    if (error && error.code === 'PGRST116') {
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
        console.error("[GET_CREDIT_BALANCE_ERROR] Failed to create user credits:", insertError);
        return {
          credits_remaining: 10,
          credits_used: 0,
          last_updated_at: new Date().toISOString(),
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
      
      return {
        credits_remaining: 10,
        credits_used: 0,
        last_updated_at: new Date().toISOString(),
      };
    }
    
    if (error || !userCredits) {
      console.error("[GET_CREDIT_BALANCE_ERROR]", error);
      return {
        credits_remaining: 0,
        credits_used: 0,
        last_updated_at: null,
      };
    }
    
    const credits_remaining = Math.max(0,
      (userCredits.free_credits || 0) +
      (userCredits.purchased_credits || 0) +
      (userCredits.subscription_credits || 0) -
      (userCredits.used_credits || 0)
    );
    
    return {
      credits_remaining,
      credits_used: userCredits.used_credits || 0,
      last_updated_at: userCredits.updated_at || null,
    };
  } catch (error) {
    console.error("[GET_CREDIT_BALANCE_ERROR] Unexpected error:", error);
    return {
      credits_remaining: 0,
      credits_used: 0,
      last_updated_at: null,
    };
  }
}

