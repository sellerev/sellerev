/**
 * Memory Merge / Update Logic
 * 
 * Implements exact merge rules for seller memories.
 * Handles conflicts, confidence levels, and pending memory queue.
 */

import { ExtractedMemory } from "./memoryExtraction";
import { SellerMemoryRecord } from "./sellerMemoryStore";

export interface PendingMemory {
  id: string;
  user_id: string;
  memory_candidate: ExtractedMemory;
  reason: 'inferred' | 'conflict' | 'low_confidence';
  created_at: string;
}

export interface MergeResult {
  action: 'insert' | 'update' | 'pending' | 'skip';
  memory?: ExtractedMemory;
  pendingReason?: 'inferred' | 'conflict' | 'low_confidence';
  shouldAskUser?: boolean;
}

/**
 * Check if two memories match (same memory_type and key)
 */
export function memoriesMatch(
  existing: SellerMemoryRecord,
  candidate: ExtractedMemory
): boolean {
  return (
    existing.memory_type === candidate.memory_type &&
    existing.key === candidate.key
  );
}

/**
 * Merge two JSON values (shallow merge, 1 level deep)
 */
function mergeJsonValues(
  existing: unknown,
  candidate: unknown
): unknown {
  if (
    typeof existing === 'object' &&
    existing !== null &&
    !Array.isArray(existing) &&
    typeof candidate === 'object' &&
    candidate !== null &&
    !Array.isArray(candidate)
  ) {
    // Shallow merge (1 level deep)
    return {
      ...(existing as Record<string, unknown>),
      ...(candidate as Record<string, unknown>),
    };
  }
  
  // Not mergeable - use candidate value
  return candidate;
}

/**
 * Determine merge action based on exact rules
 * 
 * Rule 1: Explicit User Statement Always Wins
 * Rule 2: Attachment Extraction Updates Softly
 * Rule 3: AI Inference Is Never Auto-Committed
 * Rule 4: Confidence Downgrades Are Not Allowed
 * Rule 5: Partial JSON Merges
 */
export function determineMergeAction(
  existing: SellerMemoryRecord | null,
  candidate: ExtractedMemory
): MergeResult {
  // No existing memory - check if we should insert or pending
  if (!existing) {
    if (candidate.source === 'ai_inference') {
      return {
        action: 'pending',
        pendingReason: 'inferred',
        shouldAskUser: true,
      };
    }
    
    // Insert immediately for other sources
    return {
      action: 'insert',
      memory: candidate,
    };
  }

  // Existing memory found - apply merge rules

  // Rule 1: Explicit User Statement Always Wins
  if (candidate.source === 'explicit_user_statement') {
    return {
      action: 'update',
      memory: {
        ...candidate,
        confidence: 'high',
      },
    };
  }

  // Rule 4: Confidence Downgrades Are Not Allowed
  if (
    existing.confidence === 'high' &&
    candidate.confidence !== 'high'
  ) {
    // Reject overwrite - store as pending if it's a conflict
    if (candidate.source === 'attachment_extraction') {
      return {
        action: 'pending',
        pendingReason: 'conflict',
        shouldAskUser: true,
      };
    }
    
    // Skip AI inference that would downgrade
    return {
      action: 'skip',
    };
  }

  // Rule 2: Attachment Extraction Updates Softly
  if (candidate.source === 'attachment_extraction') {
    if (existing.confidence === 'high') {
      // Do not overwrite high-confidence memory silently
      return {
        action: 'pending',
        pendingReason: 'conflict',
        shouldAskUser: true,
      };
    }
    
    // Overwrite with medium confidence
    return {
      action: 'update',
      memory: {
        ...candidate,
        confidence: 'medium',
      },
    };
  }

  // Rule 3: AI Inference Is Never Auto-Committed
  if (candidate.source === 'ai_inference') {
    return {
      action: 'pending',
      pendingReason: 'inferred',
      shouldAskUser: true,
    };
  }

  // Rule 5: Partial JSON Merges (for onboarding or other sources)
  if (candidate.source === 'onboarding') {
    const mergedValue = mergeJsonValues(existing.value, candidate.value);
    return {
      action: 'update',
      memory: {
        ...candidate,
        value: mergedValue as string | number | boolean | Record<string, unknown> | null,
        confidence: candidate.confidence || existing.confidence,
      },
    };
  }

  // Default: update with candidate
  return {
    action: 'update',
    memory: candidate,
  };
}

/**
 * Check if we should ask user to confirm a memory
 * 
 * Ask ONLY when ALL are true:
 * - The memory affects future answers
 * - The memory is durable (not scenario-based)
 * - The memory is uncertain or inferred
 * - The memory is not already confirmed
 */
export function shouldAskUserToConfirm(
  candidate: ExtractedMemory,
  reason: 'inferred' | 'conflict' | 'low_confidence'
): boolean {
  // NEVER ask for these
  const forbiddenPatterns = [
    /market|competition|competitor|niche|product opinion/i,
    /if i were|hypothetical|scenario|experiment/i,
    /one.?off|temporary|test/i,
  ];
  
  const candidateString = JSON.stringify(candidate).toLowerCase();
  if (forbiddenPatterns.some(pattern => pattern.test(candidateString))) {
    return false;
  }

  // Always ask for these memory types (if inferred or conflict)
  const alwaysAskTypes: ExtractedMemory['memory_type'][] = [
    'constraints',
    'sourcing',
    'logistics',
    'goals',
    'preferences',
  ];

  // Ask if inferred and it's a durable memory type
  if (
    reason === 'inferred' &&
    alwaysAskTypes.includes(candidate.memory_type)
  ) {
    return true;
  }

  // Ask if confidence is low and it's a durable memory type
  if (
    candidate.confidence === 'low' &&
    alwaysAskTypes.includes(candidate.memory_type)
  ) {
    return true;
  }

  // Always ask for conflicts (high-confidence memory being overwritten)
  if (reason === 'conflict') {
    return true;
  }

  return false;
}

/**
 * Format memory for user confirmation prompt
 */
export function formatMemoryForConfirmation(
  candidate: ExtractedMemory
): string {
  const typeLabels: Record<ExtractedMemory['memory_type'], string> = {
    sourcing: 'sourcing',
    costs: 'costs',
    pricing: 'pricing',
    logistics: 'logistics',
    constraints: 'constraints',
    preferences: 'preferences',
    goals: 'goals',
    experience: 'experience',
    assets: 'assets',
    strategy: 'strategy',
  };

  const keyLabels: Record<string, string> = {
    primary_sourcing_country: 'primary sourcing country',
    capital_limit_usd: 'capital limit',
    avoided_categories: 'avoided categories',
    prefers_bundles: 'preference for bundles',
    risk_tolerance: 'risk tolerance',
    primary_goal: 'primary goal',
    max_unit_weight_lbs: 'max unit weight',
    typical_cogs_percent: 'typical COGS percentage',
  };

  const typeLabel = typeLabels[candidate.memory_type] || candidate.memory_type;
  const keyLabel = keyLabels[candidate.key] || candidate.key.replace(/_/g, ' ');
  
  let valueLabel = '';
  if (typeof candidate.value === 'string') {
    valueLabel = candidate.value;
  } else if (typeof candidate.value === 'number') {
    valueLabel = candidate.value.toString();
  } else if (typeof candidate.value === 'boolean') {
    valueLabel = candidate.value ? 'Yes' : 'No';
  } else if (candidate.value && typeof candidate.value === 'object') {
    valueLabel = JSON.stringify(candidate.value);
  }

  return `${typeLabel}: ${keyLabel} = ${valueLabel}`;
}
