/**
 * One-time script to trigger the keyword-worker
 * This will reset failed items and process them automatically
 */

const SUPABASE_PROJECT_REF = "mblwxepkpolhdtaaqseu";
const SUPABASE_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`;

async function triggerWorker() {
  try {
    // The worker now automatically resets failed items and processes them
    // We just need to invoke it once
    console.log("Triggering keyword-worker...");
    
    // Use reset-and-trigger function which handles auth internally
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/reset-and-trigger`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer setup-secret-2025",
        },
      }
    );

    const result = await response.text();
    console.log("Worker response:", response.status, result);
    
    if (response.ok) {
      console.log("✅ Worker triggered successfully");
      console.log("The worker will automatically:");
      console.log("1. Reset any failed queue items to pending");
      console.log("2. Process all pending items");
      console.log("3. Write snapshots to keyword_snapshots table");
    } else {
      console.error("❌ Worker invocation failed");
      process.exit(1);
    }
  } catch (error) {
    console.error("Error triggering worker:", error);
    process.exit(1);
  }
}

triggerWorker();

