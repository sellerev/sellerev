/**
 * Background Ingestion Worker Entry Point
 * 
 * Run this as a separate process (cron job, queue worker, etc.)
 * 
 * Usage:
 *   tsx scripts/run-background-worker.ts
 * 
 * Or via cron:
 *   */5 * * * * cd /path/to/Sellerev && tsx scripts/run-background-worker.ts
 */

import { startWorker } from '../lib/snapshots/backgroundWorker';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables:');
  console.error('- NEXT_PUBLIC_SUPABASE_URL');
  console.error('- SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Create service role client for background worker
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

console.log('Starting background ingestion worker...');
console.log('Press Ctrl+C to stop');

// Start worker (runs indefinitely)
startWorker(supabase).catch((error) => {
  console.error('Worker crashed:', error);
  process.exit(1);
});

