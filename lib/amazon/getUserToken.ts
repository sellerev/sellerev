/**
 * Get User's Amazon Refresh Token
 * 
 * Server-side only helper to retrieve and decrypt a user's Amazon refresh token.
 */

import { createClient } from "@supabase/supabase-js";
import { decryptToken } from "./tokenEncryption";

/**
 * Get user's Amazon refresh token (decrypted)
 * 
 * @param userId - User ID from Supabase auth
 * @returns Decrypted refresh token, or null if not connected
 */
export async function getUserAmazonRefreshToken(
  userId: string
): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Supabase credentials not configured");
  }

  // Use service role to bypass RLS for token retrieval
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await supabase
    .from("amazon_connections")
    .select("refresh_token_encrypted, status, refresh_token_last4")
    .eq("user_id", userId)
    .eq("status", "connected")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      // No rows returned - user hasn't connected
      console.log("⚠️ No Amazon connection found for user", {
        user_id: userId.substring(0, 8) + "...",
        error_code: error.code,
      });
    } else {
      console.error("Error fetching Amazon connection:", error);
    }
    return null;
  }

  if (!data) {
    console.log("⚠️ No Amazon connection data for user", {
      user_id: userId.substring(0, 8) + "...",
    });
    return null;
  }

  try {
    const decryptedToken = decryptToken(data.refresh_token_encrypted);
    console.log("✅ Successfully retrieved user's Amazon refresh token", {
      user_id: userId.substring(0, 8) + "...",
      token_last4: data.refresh_token_last4,
      status: data.status,
    });
    return decryptedToken;
  } catch (error) {
    console.error("❌ Failed to decrypt user refresh token:", error);
    return null;
  }
}

/**
 * Check if user has an Amazon connection (connected status + valid refresh token).
 */
export async function hasAmazonConnection(userId: string): Promise<boolean> {
  const token = await getUserAmazonRefreshToken(userId);
  return token != null && token.length > 0;
}

