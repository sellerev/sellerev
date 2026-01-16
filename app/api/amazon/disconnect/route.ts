/**
 * Amazon SP-API OAuth Disconnect Route
 * 
 * Revokes user's Amazon connection by updating status.
 */

import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";

export async function POST(req: NextRequest) {
  let res = new NextResponse();
  const supabase = createApiClient(req, res);

  try {
    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401, headers: res.headers }
      );
    }

    // Update connection status to revoked
    const { error: updateError } = await supabase
      .from("amazon_connections")
      .update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
      })
      .eq("user_id", user.id)
      .eq("status", "connected");

    if (updateError) {
      console.error("Failed to revoke connection:", updateError);
      return NextResponse.json(
        { success: false, error: "Failed to disconnect" },
        { status: 500, headers: res.headers }
      );
    }

    console.log("Amazon connection revoked", {
      user_id: user.id,
    });

    return NextResponse.json(
      { success: true },
      { headers: res.headers }
    );
  } catch (error) {
    console.error("Amazon disconnect error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500, headers: res.headers }
    );
  }
}

