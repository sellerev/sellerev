/**
 * Manually process a keyword to test the pipeline
 * Usage: npx tsx scripts/manually-process-keyword.ts "vacuum storage bags"
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_PROJECT_REF = "mblwxepkpolhdtaaqseu";
const SUPABASE_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error("❌ SUPABASE_SERVICE_ROLE_KEY environment variable not set");
  process.exit(1);
}

const keyword = process.argv[2] || "vacuum storage bags";
const normalizedKeyword = keyword.toLowerCase().trim();

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  console.log(`🔄 Processing keyword: "${normalizedKeyword}"`);

  // Step 1: Check if snapshot exists
  const { data: existingSnapshot } = await supabase
    .from("keyword_snapshots")
    .select("*")
    .eq("keyword", normalizedKeyword)
    .eq("marketplace", "amazon.com")
    .single();

  if (existingSnapshot) {
    console.log("✅ Snapshot already exists:", {
      total_monthly_units: existingSnapshot.total_monthly_units,
      total_monthly_revenue: existingSnapshot.total_monthly_revenue,
      last_updated: existingSnapshot.last_updated,
    });
  } else {
    console.log("ℹ️  No snapshot found, will create one");
  }

  // Step 2: Call process-keyword function
  console.log("🔄 Calling process-keyword function...");
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/process-keyword`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ keyword: normalizedKeyword }),
    }
  );

  const result = await response.text();
  console.log("📥 Response:", response.status, result);

  if (!response.ok) {
    console.error("❌ Failed to process keyword");
    process.exit(1);
  }

  // Step 3: Verify snapshot was created/updated
  await new Promise(resolve => setTimeout(resolve, 1000));

  const { data: newSnapshot } = await supabase
    .from("keyword_snapshots")
    .select("*")
    .eq("keyword", normalizedKeyword)
    .eq("marketplace", "amazon.com")
    .single();

  if (newSnapshot) {
    console.log("✅ Snapshot verified:", {
      keyword: newSnapshot.keyword,
      total_monthly_units: newSnapshot.total_monthly_units,
      total_monthly_revenue: newSnapshot.total_monthly_revenue,
      product_count: newSnapshot.product_count,
      average_price: newSnapshot.average_price,
      last_updated: newSnapshot.last_updated,
    });
    console.log("\n✅ SUCCESS! Snapshot is ready. Refresh your UI to see the data.");
  } else {
    console.error("❌ Snapshot was not created");
    process.exit(1);
  }
}

main().catch(console.error);

