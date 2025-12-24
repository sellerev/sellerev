/**
 * Seller Memory Store
 * 
 * Manages storing and retrieving seller memories from the database.
 * Handles upserts, validation, and context building.
 */

import { ExtractedMemory } from "./memoryExtraction";

export interface SellerMemoryRecord {
  id: string;
  user_id: string;
  memory_type: string;
  key: string;
  value: unknown;
  confidence: 'low' | 'medium' | 'high';
  source: string;
  source_reference: string | null;
  is_user_editable: boolean;
  last_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Get all memories for a seller
 */
export async function getSellerMemories(
  supabase: any,
  sellerId: string
): Promise<SellerMemoryRecord[]> {
  try {
    const { data, error } = await supabase
      .from("seller_memory")
      .select("*")
      .eq("user_id", sellerId)
      .order("updated_at", { ascending: false });
    
    if (error) {
      console.error("Error fetching seller memories:", error);
      return [];
    }
    
    return data || [];
  } catch (error) {
    console.error("Error fetching seller memories:", error);
    return [];
  }
}

/**
 * Upsert memories with merge logic (insert or update)
 * 
 * Implements exact merge rules:
 * - Explicit user statements always win
 * - Attachment extraction updates softly
 * - AI inference never auto-committed
 * - Confidence downgrades not allowed
 * 
 * Returns memories that should be confirmed by user
 */
export async function upsertMemoriesWithMerge(
  supabase: any,
  sellerId: string,
  memories: ExtractedMemory[],
  sourceReference: string | null = null
): Promise<{
  inserted: number;
  updated: number;
  pending: Array<{ memory: ExtractedMemory; reason: 'inferred' | 'conflict' | 'low_confidence'; shouldAsk: boolean }>;
}> {
  if (memories.length === 0) {
    return { inserted: 0, updated: 0, pending: [] };
  }

  const {
    determineMergeAction,
    shouldAskUserToConfirm,
    memoriesMatch,
  } = await import("./memoryMerge");

  // Get all existing memories for this seller
  const existingMemories = await getSellerMemories(supabase, sellerId);
  
  const toInsert: Array<{
    user_id: string;
    memory_type: string;
    key: string;
    value: unknown;
    confidence: string;
    source: string;
    source_reference: string | null;
    is_user_editable: boolean;
    last_confirmed_at: string | null;
  }> = [];
  
  const toUpdate: Array<{
    user_id: string;
    memory_type: string;
    key: string;
    value: unknown;
    confidence: string;
    source: string;
    source_reference: string | null;
    last_confirmed_at: string | null;
  }> = [];
  
  const pending: Array<{ memory: ExtractedMemory; reason: 'inferred' | 'conflict' | 'low_confidence'; shouldAsk: boolean }> = [];

  for (const candidate of memories) {
    // Find matching existing memory
    const existing = existingMemories.find((m) =>
      memoriesMatch(m, candidate)
    );

    // Determine merge action
    const mergeResult = determineMergeAction(existing, candidate);

    if (mergeResult.action === 'insert') {
      toInsert.push({
        user_id: sellerId,
        memory_type: candidate.memory_type,
        key: candidate.key,
        value: candidate.value,
        confidence: candidate.confidence,
        source: candidate.source,
        source_reference: sourceReference,
        is_user_editable: true,
        last_confirmed_at: candidate.source === 'explicit_user_statement' ? new Date().toISOString() : null,
      });
    } else if (mergeResult.action === 'update' && mergeResult.memory) {
      const memory = mergeResult.memory;
      toUpdate.push({
        user_id: sellerId,
        memory_type: memory.memory_type,
        key: memory.key,
        value: memory.value,
        confidence: memory.confidence,
        source: memory.source,
        source_reference: sourceReference,
        last_confirmed_at: memory.source === 'explicit_user_statement' ? new Date().toISOString() : existing?.last_confirmed_at || null,
      });
    } else if (mergeResult.action === 'pending' && mergeResult.pendingReason) {
      const shouldAsk = shouldAskUserToConfirm(candidate, mergeResult.pendingReason);
      pending.push({
        memory: candidate,
        reason: mergeResult.pendingReason,
        shouldAsk,
      });
    }
    // Skip action - do nothing
  }

  // Insert new memories
  if (toInsert.length > 0) {
    const { error } = await supabase
      .from("seller_memory")
      .insert(toInsert);

    if (error) {
      console.error("Error inserting memories:", error);
      throw error;
    }
  }

  // Update existing memories
  for (const update of toUpdate) {
    const { error } = await supabase
      .from("seller_memory")
      .update({
        value: update.value,
        confidence: update.confidence,
        source: update.source,
        source_reference: update.source_reference,
        last_confirmed_at: update.last_confirmed_at,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", update.user_id)
      .eq("memory_type", update.memory_type)
      .eq("key", update.key);

    if (error) {
      console.error("Error updating memory:", error);
      throw error;
    }
  }

  // Store pending memories
  if (pending.length > 0) {
    await storePendingMemories(supabase, sellerId, pending, sourceReference);
  }

  console.log(`Memory merge: ${toInsert.length} inserted, ${toUpdate.length} updated, ${pending.length} pending`);

  return {
    inserted: toInsert.length,
    updated: toUpdate.length,
    pending: pending.filter(p => p.shouldAsk),
  };
}

/**
 * Store pending memories in the queue
 */
async function storePendingMemories(
  supabase: any,
  sellerId: string,
  pending: Array<{ memory: ExtractedMemory; reason: 'inferred' | 'conflict' | 'low_confidence'; shouldAsk: boolean }>,
  sourceReference: string | null
): Promise<void> {
  const records = pending.map(({ memory, reason }) => ({
    user_id: sellerId,
    memory_candidate: memory,
    reason,
  }));

  // Upsert pending memories (prevent duplicates)
  const { error } = await supabase
    .from("pending_memory")
    .upsert(records, {
      onConflict: "user_id,memory_candidate->>memory_type,memory_candidate->>key",
      ignoreDuplicates: false,
    });

  if (error) {
    console.error("Error storing pending memories:", error);
    // Don't throw - pending memories are non-critical
  }
}

/**
 * Legacy upsert function (for backward compatibility)
 * Now uses merge logic internally
 */
export async function upsertMemories(
  supabase: any,
  sellerId: string,
  memories: ExtractedMemory[],
  sourceReference: string | null = null
): Promise<void> {
  await upsertMemoriesWithMerge(supabase, sellerId, memories, sourceReference);
}

/**
 * Update a specific memory
 */
export async function updateMemory(
  supabase: any,
  sellerId: string,
  key: string,
  updates: {
    value?: unknown;
    confidence?: 'low' | 'medium' | 'high';
    last_confirmed_at?: string;
  }
): Promise<void> {
  try {
    const { error } = await supabase
      .from("seller_memory")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", sellerId)
      .eq("key", key);

    if (error) {
      console.error("Error updating memory:", error);
      throw error;
    }
  } catch (error) {
    console.error("Error updating memory:", error);
    throw error;
  }
}

/**
 * Delete a memory
 */
export async function deleteMemory(
  supabase: any,
  sellerId: string,
  key: string
): Promise<void> {
  try {
    const { error } = await supabase
      .from("seller_memory")
      .delete()
      .eq("user_id", sellerId)
      .eq("key", key);

    if (error) {
      console.error("Error deleting memory:", error);
      throw error;
    }
  } catch (error) {
    console.error("Error deleting memory:", error);
    throw error;
  }
}

/**
 * Get memories filtered by type
 */
export async function getMemoriesByType(
  supabase: any,
  sellerId: string,
  memoryType: string
): Promise<SellerMemoryRecord[]> {
  try {
    const { data, error } = await supabase
      .from("seller_memory")
      .select("*")
      .eq("user_id", sellerId)
      .eq("memory_type", memoryType)
      .order("updated_at", { ascending: false });
    
    if (error) {
      console.error("Error fetching memories by type:", error);
      return [];
    }
    
    return data || [];
  } catch (error) {
    console.error("Error fetching memories by type:", error);
    return [];
  }
}
