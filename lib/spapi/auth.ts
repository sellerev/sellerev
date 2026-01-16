/**
 * SP-API Authentication
 * 
 * Handles OAuth refresh token flow to obtain access tokens for Amazon SP-API.
 * Tokens are cached in memory until expiry.
 * 
 * Supports both per-user refresh tokens (from OAuth) and fallback to env token.
 */

interface TokenCache {
  accessToken: string;
  expiresAt: number;
  cacheKey: string; // Key to differentiate caches (user_id or "default")
}

// In-memory token cache (per refresh token)
const tokenCacheMap = new Map<string, TokenCache>();

/**
 * Get SP-API access token using refresh token OAuth flow
 * 
 * Caches token in memory until expiry (typically 1 hour).
 * 
 * @param options - Optional configuration
 * @param options.refreshToken - Override refresh token (for per-user tokens). If not provided, uses env token.
 * @param options.userId - User ID for cache key (optional, used for per-user token caching)
 * @returns Promise<string> Access token for SP-API requests
 */
export async function getSpApiAccessToken(options?: {
  refreshToken?: string;
  userId?: string;
}): Promise<string> {
  // Support both variable name formats for backward compatibility
  const clientId = process.env.SP_API_CLIENT_ID || process.env.SP_API_LWA_CLIENT_ID;
  const clientSecret = process.env.SP_API_CLIENT_SECRET || process.env.SP_API_LWA_CLIENT_SECRET;
  
  // Use provided refresh token or fallback to env
  const refreshToken = options?.refreshToken || process.env.SP_API_REFRESH_TOKEN;
  
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("SP-API credentials not configured");
  }

  // Create cache key (use userId if provided, otherwise "default")
  const cacheKey = options?.userId ? `user:${options.userId}` : "default";
  
  // Return cached token if still valid (with 5 minute buffer)
  const cached = tokenCacheMap.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cached.accessToken;
  }

  try {
    const response = await fetch("https://api.amazon.com/auth/o2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`SP-API token refresh failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    if (!data.access_token) {
      throw new Error("SP-API token response missing access_token");
    }

    // Cache token (expires_in is typically 3600 seconds)
    const expiresIn = data.expires_in || 3600;
    const tokenCache: TokenCache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + (expiresIn - 300) * 1000, // 5 min buffer
      cacheKey,
    };

    tokenCacheMap.set(cacheKey, tokenCache);

    return tokenCache.accessToken;
  } catch (error) {
    // Clear cache on error
    tokenCacheMap.delete(cacheKey);
    throw error;
  }
}












