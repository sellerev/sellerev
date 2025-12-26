/**
 * Background Ingestion Worker
 * 
 * Long-running worker that processes keywords from queue.
 * This is the ONLY place where Rainforest API is called.
 * 
 * Run this as a separate process (cron job, queue worker, etc.)
 */

import {
  getPendingQueueItems,
  markQueueProcessing,
  markQueueCompleted,
  markQueueFailed,
  saveKeywordSnapshot,
  getDailyProcessingCount,
} from './keywordSnapshots';
import { processKeyword } from './keywordProcessor';

const MAX_KEYWORDS_PER_DAY = 200;
const WORKER_SLEEP_MS = 60_000; // 60 seconds between cycles
const BATCH_SIZE = 10;

/**
 * Main worker loop
 */
export async function backgroundIngestionWorker(
  supabase: any,
  options: {
    maxDailyKeywords?: number;
    batchSize?: number;
    sleepMs?: number;
  } = {}
): Promise<void> {
  const maxDaily = options.maxDailyKeywords ?? MAX_KEYWORDS_PER_DAY;
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const sleepMs = options.sleepMs ?? WORKER_SLEEP_MS;

  console.log('Background ingestion worker started', {
    maxDailyKeywords: maxDaily,
    batchSize,
    sleepMs,
  });

  while (true) {
    try {
      // Check daily limit
      const processedToday = await getDailyProcessingCount(supabase);
      const remaining = maxDaily - processedToday;

      if (remaining <= 0) {
        console.log('Daily keyword limit reached, sleeping...', {
          processedToday,
          maxDaily,
        });
        await sleep(sleepMs);
        continue;
      }

      // Get pending items
      const pendingItems = await getPendingQueueItems(supabase, Math.min(batchSize, remaining));

      if (pendingItems.length === 0) {
        console.log('No pending keywords, sleeping...');
        await sleep(sleepMs);
        continue;
      }

      console.log(`Processing ${pendingItems.length} keywords...`, {
        remainingDaily: remaining,
      });

      // Process sequentially (rate-limited)
      for (const item of pendingItems) {
        try {
          // Mark as processing
          const claimed = await markQueueProcessing(supabase, item.id);
          if (!claimed) {
            console.log('Skipping item, already being processed', { id: item.id });
            continue;
          }

          console.log('Processing keyword', {
            id: item.id,
            keyword: item.keyword,
            priority: item.priority,
          });

          // Process keyword
          const result = await processKeyword(supabase, item.keyword, item.marketplace);

          if (result.success && result.snapshot && result.products) {
            // Save snapshot and products
            const saved = await saveKeywordSnapshot(
              supabase,
              result.snapshot,
              result.products
            );

            if (saved) {
              await markQueueCompleted(supabase, item.id);
              console.log('Keyword processed successfully', {
                id: item.id,
                keyword: item.keyword,
                productCount: result.products.length,
              });
            } else {
              await markQueueFailed(supabase, item.id, 'Failed to save snapshot');
              console.error('Failed to save snapshot', { id: item.id, keyword: item.keyword });
            }
          } else {
            await markQueueFailed(supabase, item.id, result.error || 'Unknown error');
            console.error('Keyword processing failed', {
              id: item.id,
              keyword: item.keyword,
              error: result.error,
            });
          }

          // Small delay between keywords to avoid rate limiting
          await sleep(2000);

        } catch (error) {
          console.error('Error processing keyword', {
            id: item.id,
            keyword: item.keyword,
            error: error instanceof Error ? error.message : String(error),
          });

          await markQueueFailed(
            supabase,
            item.id,
            error instanceof Error ? error.message : 'Processing exception'
          );
        }
      }

    } catch (error) {
      console.error('Worker loop error:', error);
      // Don't crash - continue loop
    }

    // Sleep before next cycle
    await sleep(sleepMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Start worker (entry point for cron/process manager)
 */
export async function startWorker(supabase: any): Promise<void> {
  console.log('Starting background ingestion worker...');
  await backgroundIngestionWorker(supabase);
}

