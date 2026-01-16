/**
 * Amazon SP-API OAuth Connect Route
 * 
 * Initiates OAuth flow by redirecting user to Amazon authorization URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";
import { randomBytes } from "crypto";

export async function GET(req: NextRequest) {
  let res = new NextResponse();
  const supabase = createApiClient(req, res);

  try {
    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.redirect(
        new URL("/auth?error=unauthorized", req.url)
      );
    }

    // Get OAuth configuration
    // SP-API seller authorization does not use OAuth scopes or OpenID.
    const clientId = process.env.SP_API_CLIENT_ID || process.env.SP_API_LWA_CLIENT_ID;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : "http://localhost:3000";

    if (!clientId) {
      console.error("SP-API client ID not configured");
      return NextResponse.redirect(
        new URL("/settings?error=config", req.url)
      );
    }

    // Generate CSRF state token
    const state = randomBytes(32).toString("hex");
    
    // Store state in secure cookie (httpOnly, sameSite, 10 min TTL)
    res.cookies.set("amazon_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600, // 10 minutes
      path: "/",
    });

    // Build authorization URL manually to ensure no OpenID parameters are added
    // SP-API seller authorization does not use OAuth scopes or OpenID.
    const redirectUri = `${appUrl}/api/amazon/callback`;
    
    // Check if user is in onboarding flow (no profile yet)
    const { data: profile } = await supabase
      .from("seller_profiles")
      .select("id, sourcing_model")
      .eq("id", user.id)
      .single();

    // Manually construct query string to ensure ONLY required parameters
    // Base URL: https://www.amazon.com/ap/oa
    // Parameters: client_id, response_type=code, redirect_uri, state
    // DO NOT include: scope, openid, profile, email, prompt, claims, openid.assoc_handle
    const queryParams = new URLSearchParams();
    queryParams.set("client_id", clientId);
    queryParams.set("response_type", "code");
    queryParams.set("redirect_uri", redirectUri);
    queryParams.set("state", state);
    
    // Construct final URL manually (don't use URL object to avoid any auto-injection)
    const authUrl = `https://www.amazon.com/ap/oa?${queryParams.toString()}`;
    
    // Store return destination in state cookie (will be checked in callback)
    if (!profile || !profile.sourcing_model) {
      res.cookies.set("amazon_oauth_return_to", "onboarding", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 600, // 10 minutes
        path: "/",
      });
    }

    console.log("Amazon OAuth connect initiated", {
      user_id: user.id,
      state: state.substring(0, 8) + "...",
      redirect_uri: redirectUri,
      auth_url: authUrl, // Log the full URL for debugging
    });

    // Redirect to Amazon (using string URL, not URL object)
    return NextResponse.redirect(authUrl, { headers: res.headers });
  } catch (error) {
    console.error("Amazon OAuth connect error:", error);
    return NextResponse.redirect(
      new URL("/settings?error=oauth_failed", req.url)
    );
  }
}

