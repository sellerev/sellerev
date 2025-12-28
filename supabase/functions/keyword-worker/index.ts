import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const MAX_KEYWORDS_PER_RUN = 10;

/**
 * ONE-SHOT WORKER EXECUTION
 * 
 * Processes pending queue items and exits.
 * Designed to be called by Supabase CRON every 2 minutes.
 * 
 * NO infinite loops
 * NO while(true)
 * NO manual triggers required
 */
Deno.serve(async () => {
  console.log("🔄 Keyword worker starting (one-shot execution)");

  // Get pending queue items
  const { data: queue, error } = await supabase
    .from("keyword_queue")
    .select("*")
    .eq("status", "pending")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(MAX_KEYWORDS_PER_RUN);

  if (error) {
    console.error("❌ Queue error:", error);
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (!queue || queue.length === 0) {
    console.log("ℹ️  No keywords to process");
    return new Response(JSON.stringify({ message: "No work", processed: 0 }), { 
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  console.log(`📋 Processing ${queue.length} keywords`);

  let processed = 0;
  let failed = 0;

  // Process each keyword with Tier-2 enrichment
  for (const item of queue) {
    const normalizedKeyword = item.keyword.toLowerCase().trim();
    console.log(`⚙️  Processing: ${normalizedKeyword}`);

    // Mark as processing
    await supabase
      .from("keyword_queue")
      .update({ 
        status: "processing",
        processing_started_at: new Date().toISOString()
      })
      .eq("id", item.id);

    try {
      // Call process-keyword function for Tier-2 enrichment
      // Pass tier=2 to trigger Rainforest API calls
      const res = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/process-keyword`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ keyword: normalizedKeyword, tier: 'tier2' }),
        }
      );

      const responseText = await res.text();
      let responseData: any = null;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        // Response might not be JSON
      }

      if (!res.ok || !responseData?.success) {
        throw new Error(responseData?.error || `HTTP ${res.status}: ${responseText}`);
      }

      // Verify snapshot was saved
      const { data: verifySnapshot, error: verifyError } = await supabase
        .from("keyword_snapshots")
        .select("keyword, total_monthly_units, total_monthly_revenue")
        .eq("keyword", normalizedKeyword)
        .eq("marketplace", item.marketplace || "amazon.com")
        .single();

      if (verifyError || !verifySnapshot) {
        throw new Error("Snapshot verification failed after processing");
      }

      console.log(`✅ Tier-2 enrichment complete: ${normalizedKeyword}`, {
        total_monthly_units: verifySnapshot.total_monthly_units,
        total_monthly_revenue: verifySnapshot.total_monthly_revenue,
      });

      // Mark as completed
      await supabase
        .from("keyword_queue")
        .update({ 
          status: "completed",
          completed_at: new Date().toISOString()
        })
        .eq("id", item.id);

      processed++;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Failed to process ${normalizedKeyword}:`, errorMsg);

      // Mark as failed
      await supabase
        .from("keyword_queue")
        .update({ 
          status: "failed",
          error_message: errorMsg.substring(0, 500),
          completed_at: new Date().toISOString()
        })
        .eq("id", item.id);

      failed++;
    }
  }

  console.log(`✅ Worker run complete: ${processed} processed, ${failed} failed`);

  return new Response(JSON.stringify({ 
    message: "Worker run complete",
    processed,
    failed,
    total: queue.length
  }), { 
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
});