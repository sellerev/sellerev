/**
 * Debug endpoint to verify OAuth URL configuration.
 * Only available in development or when explicitly enabled.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAppUrl, getOAuthCallbackUrl } from "@/lib/utils/appUrl";

export async function GET(req: NextRequest) {
  // Only allow in development or if explicitly enabled via env var
  const isDevelopment = process.env.NODE_ENV === "development";
  const isDebugEnabled = process.env.ENABLE_OAUTH_DEBUG === "true";

  if (!isDevelopment && !isDebugEnabled) {
    return NextResponse.json(
      { error: "Debug endpoint disabled in production. Set ENABLE_OAUTH_DEBUG=true to enable." },
      { status: 403 }
    );
  }

  const appUrl = getAppUrl();
  const callbackUrl = getOAuthCallbackUrl();
  const loginUrl = `${appUrl}/login`;

  return NextResponse.json({
    environment: process.env.NODE_ENV,
    computed_urls: {
      base_url: appUrl,
      oauth_callback_url: callbackUrl,
      oauth_login_url: loginUrl,
    },
    environment_variables: {
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || "not set",
      VERCEL_URL: process.env.VERCEL_URL || "not set",
      NODE_ENV: process.env.NODE_ENV || "not set",
    },
    amazon_portal_urls: {
      oauth_login_uri: loginUrl,
      oauth_redirect_uri: callbackUrl,
      note: "OAuth Login URI is where Amazon reviewers start in our app. OAuth Redirect URI is the callback where Amazon returns after consent.",
    },
  });
}

