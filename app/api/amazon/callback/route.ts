/**
 * Amazon SP-API OAuth Callback Route
 * 
 * Handles OAuth callback from Amazon, exchanges authorization code for tokens,
 * and stores encrypted refresh token.
 */

import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";
import { createClient } from "@supabase/supabase-js";
import { encryptToken, getTokenLast4 } from "@/lib/amazon/tokenEncryption";

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

    // Get query parameters
    const searchParams = req.nextUrl.searchParams;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    // Check return destination from cookie
    const returnTo = req.cookies.get("amazon_oauth_return_to")?.value;
    const errorRedirect = returnTo === "onboarding" 
      ? "/connect-amazon?error=oauth_failed"
      : "/settings?error=oauth_denied";

    // Handle OAuth errors
    if (error) {
      console.error("Amazon OAuth error:", error);
      return NextResponse.redirect(new URL(errorRedirect, req.url));
    }

    if (!code || !state) {
      return NextResponse.redirect(
        new URL(returnTo === "onboarding" ? "/connect-amazon?error=missing_params" : "/settings?error=missing_params", req.url)
      );
    }

    // Validate state token
    const storedState = req.cookies.get("amazon_oauth_state")?.value;
    if (!storedState || storedState !== state) {
      console.error("OAuth state mismatch", {
        stored: storedState?.substring(0, 8),
        received: state.substring(0, 8),
      });
      return NextResponse.redirect(
        new URL(returnTo === "onboarding" ? "/connect-amazon?error=state_mismatch" : "/settings?error=state_mismatch", req.url)
      );
    }

    // Clear state cookie
    res.cookies.delete("amazon_oauth_state");

    // Get OAuth configuration
    const clientId = process.env.SP_API_CLIENT_ID || process.env.SP_API_LWA_CLIENT_ID;
    const clientSecret = process.env.SP_API_CLIENT_SECRET || process.env.SP_API_LWA_CLIENT_SECRET;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : "http://localhost:3000";
    const redirectUri = `${appUrl}/api/amazon/callback`;

    if (!clientId || !clientSecret) {
      console.error("SP-API credentials not configured");
      const errorRedirect = returnTo === "onboarding" 
        ? "/connect-amazon?error=config"
        : "/settings?error=config";
      return NextResponse.redirect(new URL(errorRedirect, req.url));
    }

    // Exchange authorization code for tokens
    const tokenResponse = await fetch("https://api.amazon.com/auth/o2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text().catch(() => "Unknown error");
      console.error("Token exchange failed:", tokenResponse.status, errorText);
      const errorRedirect = returnTo === "onboarding" 
        ? "/connect-amazon?error=token_exchange_failed"
        : "/settings?error=token_exchange_failed";
      return NextResponse.redirect(new URL(errorRedirect, req.url));
    }

    const tokenData = await tokenResponse.json();

    if (!tokenData.refresh_token) {
      console.error("Token response missing refresh_token");
      const errorRedirect = returnTo === "onboarding" 
        ? "/connect-amazon?error=no_refresh_token"
        : "/settings?error=no_refresh_token";
      return NextResponse.redirect(new URL(errorRedirect, req.url));
    }

    // Encrypt refresh token
    const encryptedToken = encryptToken(tokenData.refresh_token);
    const tokenLast4 = getTokenLast4(tokenData.refresh_token);

    // Store in database using service role (to bypass RLS for token storage)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase service role key not configured");
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Upsert connection (one per user)
    // Note: SP-API token responses don't include scope. Permissions come from IAM role configuration.
    const { error: dbError } = await supabaseAdmin
      .from("amazon_connections")
      .upsert({
        user_id: user.id,
        refresh_token_encrypted: encryptedToken,
        refresh_token_last4: tokenLast4,
        scopes: tokenData.scope ? [tokenData.scope] : [], // SP-API doesn't return scopes in token response
        status: "connected",
        revoked_at: null,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "user_id",
      });

    if (dbError) {
      console.error("Failed to store connection:", dbError);
      const errorRedirect = returnTo === "onboarding" 
        ? "/connect-amazon?error=storage_failed"
        : "/settings?error=storage_failed";
      return NextResponse.redirect(new URL(errorRedirect, req.url));
    }

    console.log("Amazon OAuth connection successful", {
      user_id: user.id,
      token_last4: tokenLast4,
    });

    // Clear return destination cookie (we already have returnTo from line 37)
    res.cookies.delete("amazon_oauth_return_to");

    // If returning to onboarding flow, redirect to connect-amazon success page
    if (returnTo === "onboarding") {
      return NextResponse.redirect(
        new URL("/connect-amazon?connected=amazon", req.url),
        { headers: res.headers }
      );
    }

    // Otherwise, redirect to settings
    return NextResponse.redirect(
      new URL("/settings?connected=amazon", req.url),
      { headers: res.headers }
    );
  } catch (error) {
    console.error("Amazon OAuth callback error:", error);
    // Try to get return destination, but default to settings if unavailable
    const returnTo = req.cookies.get("amazon_oauth_return_to")?.value;
    const errorRedirect = returnTo === "onboarding" 
      ? "/connect-amazon?error=callback_failed"
      : "/settings?error=callback_failed";
    return NextResponse.redirect(new URL(errorRedirect, req.url));
  }
}

