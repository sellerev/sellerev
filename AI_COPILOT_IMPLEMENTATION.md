# AI Copilot Behavior Layer Implementation

**Date:** 2025-01-17  
**Status:** ✅ Complete

---

## Overview

Implemented Sellerev's AI Copilot as a persistent, data-grounded reasoning layer with locked behavior contract. This is NOT a chatbot - it's a project-aware analyst that learns the seller over time.

---

## Core Principles (Locked)

### 1. DATA FIRST, AI SECOND
- AI NEVER invents metrics
- AI NEVER overrides raw data
- AI NEVER hides uncertainty
- AI ALWAYS cites the data object it is reasoning from

### 2. HELIUM 10–STYLE CONCRETE OUTPUT
- Users can read raw numbers themselves
- AI summarizes, explains implications, and answers questions
- Scores/verdicts are SECONDARY and optional
- Raw tables, estimates, and breakdowns are primary

### 3. SPELLBOOK-STYLE MEMORY (PROJECT CONTEXT)
- Each user has persistent memory
- Memory shapes future answers
- Memory NEVER changes historical data
- Memory only influences interpretation, tone, and recommendations

---

## Implementation Components

### 1. Seller Memory System (`lib/ai/sellerMemory.ts`)

**Schema:**
```typescript
seller_memory: {
  seller_profile: {
    stage: "pre-launch" | "launching" | "scaling" | "established",
    experience_level: "new" | "intermediate" | "advanced",
    monthly_revenue_range: string | null,
    sourcing_model: "china" | "domestic" | "private_label" | "wholesale",
    capital_constraints: "low" | "medium" | "high",
    risk_tolerance: "low" | "medium" | "high",
    target_margin_pct: number | null,
    long_term_goal: string | null
  },
  preferences: {
    prefers_data_over_summary: boolean,
    dislikes_scores_only: boolean,
    wants_h10_style_numbers: boolean,
    pricing_sensitivity: "low" | "medium" | "high"
  },
  saved_assumptions: {
    default_cogs_pct: number | null,
    default_launch_budget: number | null,
    default_acos_target: number | null
  },
  historical_context: {
    analyzed_keywords: string[],
    analyzed_asins: string[],
    rejected_opportunities: string[],
    accepted_opportunities: string[]
  }
}
```

**Database:**
- Table: `seller_memory` (created via migration)
- RLS enabled: Users can only access their own memory
- Auto-updates `updated_at` timestamp

**Features:**
- Default memory creation for new users
- Automatic mapping from `seller_profiles` table
- Validation of memory structure
- Append-only historical context (keywords/ASINs)

### 2. Memory Update Helpers (`lib/ai/memoryUpdates.ts`)

**Rules:**
- Memory updates require explicit user confirmation
- Never infer irreversible facts without confirmation
- Memory updates must be explainable

**Functions:**
- `updateSellerMemory()` - General memory update with confirmation
- `recordAnalyzedKeyword()` - Append-only (no confirmation needed)
- `recordAnalyzedAsin()` - Append-only (no confirmation needed)
- `recordRejectedOpportunity()` - Requires confirmation
- `recordAcceptedOpportunity()` - Requires confirmation

### 3. AI Copilot System Prompt (`lib/ai/copilotSystemPrompt.ts`)

**Locked Behavior Contract:**
- Data-first approach with explicit citations
- Helium 10-style concrete output (raw numbers primary)
- Spellbook-style memory integration
- Mode-specific behavior (keyword vs ASIN)
- Prohibited behaviors (no hallucination, no training data references)
- Long-term learning behavior (adjusts tone, references past decisions)

**Input Structure:**
```typescript
{
  ai_context: { ...locked analyze contract },
  seller_memory: { ...persistent memory },
  session_context: {
    current_feature: "analyze" | "listing_optimization" | "ppc" | "keywords",
    user_question: string
  }
}
```

**Output Structure (Mandatory):**
1. DATA INTERPRETATION - Restate relevant numbers, explain meaning
2. STRATEGIC IMPLICATION - What numbers imply FOR THIS SELLER
3. SCENARIO ANSWER - Answer "what if" questions (if applicable)
4. NEXT ACTIONS - Clear, optional, ranked actions

### 4. Chat Route Integration (`app/api/chat/route.ts`)

**Updates:**
- Loads or creates `seller_memory` for each user
- Automatically records analyzed keywords/ASINs
- Uses copilot system prompt instead of legacy prompt
- Passes `ai_context` from analyze contract
- Logs AI reasoning inputs for audit/debugging
- Enhanced hallucination tripwire with memory context

**Logging:**
- `AI_COPILOT_INPUT` - Logs all AI inputs (analysis mode, memory version, etc.)
- `AI_COPILOT_RESPONSE` - Logs successful responses
- `AI_COPILOT_HALLUCINATION_TRIPWIRE` - Logs validation failures

---

## Database Migration

**File:** `supabase/migrations/20250117_add_seller_memory.sql`

Creates:
- `seller_memory` table with JSONB storage
- RLS policies (users can only access their own memory)
- Auto-update trigger for `updated_at` timestamp

---

## Behavior Guarantees

### What AI CAN Do:
- ✅ Reason over provided `ai_context` data
- ✅ Use `seller_memory` to contextualize answers
- ✅ Reference past decisions from historical context
- ✅ Adjust tone based on seller sophistication
- ✅ Propose assumptions when data is missing (clearly labeled)

### What AI CANNOT Do:
- ❌ Pull external data
- ❌ Estimate new numbers not in `ai_context`
- ❌ Recompute market metrics
- ❌ Contradict the analyze contract
- ❌ Change historical outputs
- ❌ Rewrite past conclusions
- ❌ Reference training data or competitors by name

---

## Future Features Integration

All future features must integrate into this AI contract:

1. **Listing Optimization:** Use `ai_context` from listing analysis
2. **PPC Analysis:** Use `ai_context` from PPC data
3. **Keyword Research:** Use `ai_context` from keyword analysis

The contract remains stable - new features add to `ai_context`, they don't change the structure.

---

## Testing Checklist

- [ ] New user gets default memory created
- [ ] Memory persists across sessions
- [ ] Analyzed keywords/ASINs are recorded automatically
- [ ] AI uses memory to contextualize answers
- [ ] AI cites data from `ai_context` only
- [ ] Hallucination tripwire catches invented metrics
- [ ] Logging captures all AI inputs/outputs
- [ ] Memory updates require confirmation (for irreversible changes)

---

## Notes

- The behavior contract is **LOCKED** - do not modify without explicit approval
- Memory updates are append-only for historical context (keywords/ASINs)
- Memory updates require confirmation for preferences/assumptions
- All AI reasoning is logged for audit/debugging
- Backward compatibility: Falls back to legacy context if `ai_context` missing
