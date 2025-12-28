import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const MAX_KEYWORDS_PER_RUN = 5;

Deno.serve(async () => {
  console.log("🔄 Keyword worker running");

  // Check for pending items first
  let { data: queue, error } = await supabase
    .from("keyword_queue")
    .select("*")
    .eq("status", "pending")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(MAX_KEYWORDS_PER_RUN);

  if (error) {
    console.error(error);
    return new Response("Queue error", { status: 500 });
  }

  // If no pending items, check for failed items and reset them, then process
  if (!queue || queue.length === 0) {
    console.log("No pending items, checking for failed items to reset...");
    const { error: resetError } = await supabase
      .from("keyword_queue")
      .update({ status: "pending" })
      .eq("status", "failed");

    if (resetError) {
      console.error("Error resetting failed items:", resetError);
    } else {
      console.log("Failed items reset to pending, fetching for processing...");
      // Fetch the newly reset items and process them
      const result = await supabase
        .from("keyword_queue")
        .select("*")
        .eq("status", "pending")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(MAX_KEYWORDS_PER_RUN);

      if (!result.error && result.data && result.data.length > 0) {
        console.log(`Processing ${result.data.length} reset items...`);
        queue = result.data;
      } else {
        return new Response("No keywords to process", { status: 200 });
      }
    }
  }

  if (!queue || queue.length === 0) {
    return new Response("No keywords to process", { status: 200 });
  }

  for (const item of queue) {
    console.log("⚙️ Processing:", item.keyword);

    await supabase
      .from("keyword_queue")
      .update({ status: "processing" })
      .eq("id", item.id);

    // Call your existing processor
    const res = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/process-keyword`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ keyword: item.keyword }),
      }
    );

    if (!res.ok) {
      await supabase
        .from("keyword_queue")
        .update({ status: "failed" })
        .eq("id", item.id);

      continue;
    }

    await supabase
      .from("keyword_queue")
      .update({ status: "completed" })
      .eq("id", item.id);
  }

  // After processing, if we reset any failed items, trigger another run to process them
  // This ensures failed items get processed immediately
  const responseText = `Worker run complete. Processed ${queue.length} items.`;
  
  return new Response(responseText, { status: 200 });
});