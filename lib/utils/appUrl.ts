/**
 * Get the base application URL for OAuth redirects and other absolute URLs.
 * 
 * Production: https://sellerev.com
 * Development: http://localhost:3000
 * 
 * This is the single source of truth for app URLs.
 */
export function getAppUrl(): string {
  // In production, always use sellerev.com
  if (process.env.NODE_ENV === "production") {
    return "https://sellerev.com";
  }

  // In development, use NEXT_PUBLIC_APP_URL if set, otherwise localhost
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

/**
 * Get the OAuth callback URL for Amazon OAuth flow.
 */
export function getOAuthCallbackUrl(): string {
  return `${getAppUrl()}/api/amazon/callback`;
}

