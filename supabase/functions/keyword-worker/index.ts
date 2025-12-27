import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

Deno.serve(async () => {
  console.log("🔄 Keyword worker started")

  // 1. Pull a few pending keywords
  const { data: queue, error } = await supabase
    .from("keyword_queue")
    .select("*")
    .eq("status", "pending")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(5)

  if (error) {
    console.error("❌ Failed to read queue", error)
    return new Response("Queue error", { status: 500 })
  }

  if (!queue || queue.length === 0) {
    console.log("✅ No keywords to process")
    return new Response("No work", { status: 200 })
  }

  for (const item of queue) {
    console.log(`⚙️ Processing keyword: ${item.keyword}`)

    // TEMP: mark as completed (we’ll add real logic next)
    await supabase
      .from("keyword_queue")
      .update({ status: "completed" })
      .eq("id", item.id)
  }

  console.log("✅ Worker run finished")
  return new Response("Worker complete", { status: 200 })
})