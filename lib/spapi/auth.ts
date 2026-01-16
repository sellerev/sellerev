/**
 * SP-API Authentication
 * 
 * Handles OAuth refresh token flow to obtain access tokens for Amazon SP-API.
 * Tokens are cached in memory until expiry.
 */

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

// In-memory token cache
let tokenCache: TokenCache | null = null;

/**
 * Get SP-API access token using refresh token OAuth flow
 * 
 * Caches token in memory until expiry (typically 1 hour).
 * 
 * Required environment variables:
 * - SP_API_CLIENT_ID or SP_API_LWA_CLIENT_ID: LWA client ID
 * - SP_API_CLIENT_SECRET or SP_API_LWA_CLIENT_SECRET: LWA client secret
 * - SP_API_REFRESH_TOKEN: OAuth refresh token
 * 
 * @returns Promise<string> Access token for SP-API requests
 */
export async function getSpApiAccessToken(): Promise<string> {
  // Return cached token if still valid (with 5 minute buffer)
  if (tokenCache && tokenCache.expiresAt > Date.now() + 5 * 60 * 1000) {
    return tokenCache.accessToken;
  }

  // Support both variable name formats for backward compatibility
  const clientId = process.env.SP_API_CLIENT_ID || process.env.SP_API_LWA_CLIENT_ID;
  const clientSecret = process.env.SP_API_CLIENT_SECRET || process.env.SP_API_LWA_CLIENT_SECRET;
  const refreshToken = process.env.SP_API_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("SP-API credentials not configured");
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
    tokenCache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + (expiresIn - 300) * 1000, // 5 min buffer
    };

    return tokenCache.accessToken;
  } catch (error) {
    // Clear cache on error
    tokenCache = null;
    throw error;
  }
}












