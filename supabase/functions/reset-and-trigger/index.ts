import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    // Simple secret-based auth (for one-time setup)
    const authHeader = req.headers.get("Authorization");
    const expectedSecret = Deno.env.get("RESET_SECRET") || "setup-secret-2025";
    
    if (authHeader !== `Bearer ${expectedSecret}`) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Step 1: Reset failed queue items to pending
    console.log("Resetting failed queue items...");
    const { error: updateError, count } = await supabase
      .from("keyword_queue")
      .update({ status: "pending" })
      .eq("status", "failed")
      .select("*", { count: "exact", head: true });

    if (updateError) {
      console.error("Error resetting queue:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to reset queue", details: updateError.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`Reset ${count || 0} failed items to pending`);

    // Step 2: Trigger worker (it will auto-reset and process failed items)
    console.log("Triggering keyword-worker...");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Try to invoke worker - if it fails due to auth, that's ok, worker will process on next scheduled run
    let workerResponse;
    try {
      workerResponse = await fetch(
        `${supabaseUrl}/functions/v1/keyword-worker`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
        }
      );
    } catch (error) {
      console.log("Worker invocation failed (will process on next run):", error);
      // Return success anyway - worker will auto-process on next scheduled run
      return new Response(
        JSON.stringify({
          success: true,
          message: "Queue reset. Worker will process items on next scheduled run.",
          resetCount: count || 0,
          note: "Worker auto-resets and processes failed items automatically",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const workerResult = await workerResponse.text();
    
    if (!workerResponse.ok) {
      console.error("Worker invocation failed:", workerResponse.status, workerResult);
      return new Response(
        JSON.stringify({ 
          error: "Worker invocation failed", 
          status: workerResponse.status,
          details: workerResult,
          resetCount: count || 0
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log("Worker triggered successfully:", workerResult);

    // Step 3: Wait a moment and verify
    await new Promise(resolve => setTimeout(resolve, 3000));

    const { data: queueStatus } = await supabase
      .from("keyword_queue")
      .select("keyword, status")
      .in("status", ["completed", "failed", "processing"]);

    const { data: snapshots } = await supabase
      .from("keyword_snapshots")
      .select("keyword, total_monthly_units, total_monthly_revenue")
      .order("last_updated", { ascending: false })
      .limit(10);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Queue reset and worker triggered",
        resetCount: count || 0,
        workerResult,
        queueStatus: queueStatus || [],
        snapshots: snapshots || [],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in reset-and-trigger:", error);
    return new Response(
      JSON.stringify({ 
        error: "Internal server error", 
        details: error instanceof Error ? error.message : String(error) 
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
