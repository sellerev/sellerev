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
    // SP-API seller authorization uses Seller Central consent, not Login With Amazon.
    // We need the SP-API application_id (amzn1.sp.solution.*), NOT the LWA client_id.
    const applicationId = process.env.SP_API_APPLICATION_ID || process.env.SP_API_APP_ID;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : "http://localhost:3000";

    if (!applicationId) {
      console.error("SP-API application ID not configured. Need SP_API_APPLICATION_ID or SP_API_APP_ID (format: amzn1.sp.solution.*)");
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

    // Build authorization URL for SP-API seller authorization
    // SP-API seller authorization uses Seller Central consent, not Login With Amazon.
    const redirectUri = `${appUrl}/api/amazon/callback`;
    
    // Check if user is in onboarding flow (no profile yet)
    const { data: profile } = await supabase
      .from("seller_profiles")
      .select("id, sourcing_model")
      .eq("id", user.id)
      .single();

    // Manually construct query string for Seller Central consent endpoint
    // Base URL: https://sellercentral.amazon.com/apps/authorize/consent
    // Parameters: application_id, redirect_uri, state
    // DO NOT include: client_id, scope, openid, profile, email, response_type
    const queryParams = new URLSearchParams();
    queryParams.set("application_id", applicationId);
    queryParams.set("redirect_uri", redirectUri);
    queryParams.set("state", state);
    
    // If app is in draft/beta status, add version=beta
    const useBeta = process.env.SP_API_USE_BETA === "true";
    if (useBeta) {
      queryParams.set("version", "beta");
    }
    
    // Construct final URL manually (Seller Central endpoint, not LWA)
    const authUrl = `https://sellercentral.amazon.com/apps/authorize/consent?${queryParams.toString()}`;
    
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

