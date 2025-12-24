/**
 * Seller Memory Store
 * 
 * Manages storing and retrieving seller memories from the database.
 * Handles upserts, validation, and context building.
 */

import { ExtractedMemory } from "./memoryExtraction";

export interface SellerMemoryRecord {
  id: string;
  seller_id: string;
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
      .eq("seller_id", sellerId)
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
 * Upsert memories (insert or update)
 * 
 * If a memory with the same seller_id + key exists, update it.
 * Otherwise, insert a new memory.
 */
export async function upsertMemories(
  supabase: any,
  sellerId: string,
  memories: ExtractedMemory[],
  sourceReference: string | null = null
): Promise<void> {
  if (memories.length === 0) {
    return;
  }

  try {
    // Prepare records for upsert
    const records = memories.map((memory) => ({
      seller_id: sellerId,
      memory_type: memory.memory_type,
      key: memory.key,
      value: memory.value,
      confidence: memory.confidence,
      source: memory.source,
      source_reference: sourceReference,
      is_user_editable: true,
    }));

    // Upsert using the unique constraint (seller_id, key)
    const { error } = await supabase
      .from("seller_memory")
      .upsert(records, {
        onConflict: "seller_id,key",
        ignoreDuplicates: false,
      });

    if (error) {
      console.error("Error upserting memories:", error);
      throw error;
    }

    console.log(`Upserted ${memories.length} memories for seller ${sellerId}`);
  } catch (error) {
    console.error("Error upserting memories:", error);
    throw error;
  }
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
      .eq("seller_id", sellerId)
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
      .eq("seller_id", sellerId)
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
      .eq("seller_id", sellerId)
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
