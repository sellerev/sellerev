# Copilot Escalation Decision Engine - Implementation Summary

**Status:** ✅ Implemented (Step 4 Complete)  
**Date:** 2024

---

## Overview

The Copilot Escalation Decision Engine has been implemented to enforce:
- **Page-1 Contract** (frozen)
- **Escalation Policy** (frozen)
- **Credit & Pricing Policy** (frozen)

The engine makes explicit, enforceable decisions about when Copilot can escalate to `type=product` API calls versus when it must answer using Page-1 data only.

---

## Implementation Files

### 1. Core Decision Engine
**File:** `lib/ai/copilotEscalation.ts`

**Key Functions:**
- `decideEscalation()` - Main decision function that analyzes questions and returns escalation decision
- `buildEscalationMessage()` - Builds user-facing escalation notification
- `buildInsufficientCreditsMessage()` - Builds message when credits unavailable

**Key Types:**
- `EscalationDecision` - Complete decision result with all metadata
- `Page1Context` - Page-1 data available to Copilot
- `CreditContext` - Credit availability and limits

### 2. Escalation Helpers
**File:** `lib/ai/copilotEscalationHelpers.ts`

**Key Functions:**
- `checkCreditBalance()` - Checks available credits from database (placeholder for Step 5)
- `checkCacheForAsins()` - Checks if ASIN data is cached (placeholder for Step 5)
- `fetchProductDetails()` - Makes Rainforest API `type=product` call
- `cacheProductDetails()` - Caches product data (placeholder for Step 5)
- `deductCredits()` - Deducts credits from user account (placeholder for Step 5)
- `executeEscalation()` - Orchestrates escalation: cache check → API call → credit deduction

### 3. Policy Rules
**File:** `lib/ai/escalationPolicyRules.ts`

**Purpose:** Contains frozen policy rules as TypeScript constants for reference and validation.

### 4. Chat Route Integration
**File:** `app/api/chat/route.ts`

**Integration Points:**
- Escalation decision made before building system prompt
- Credit balance checked before escalation
- Escalation executed if needed and credits available
- Escalation results injected into AI context
- Escalation message shown to user

---

## Decision Flow

### Step 1: Question Analysis
```
User Question → decideEscalation()
  ↓
Check if answerable from Page-1 data
  ↓
If yes → can_answer_from_page1 = true, requires_escalation = false
If no → Continue to Step 2
```

### Step 2: Escalation Requirement Check
```
Check if question requires:
  - Product specifications (dimensions, materials, features)
  - Historical data (price trends, BSR history)
  - Seller account information (seller name, seller rating)
  - Product variations (color options, size options)
  ↓
If yes → requires_escalation = true
If no → Answer with Page-1 data + qualitative reasoning
```

### Step 3: ASIN Extraction
```
Extract ASINs from question:
  - Explicit ASINs (B followed by 9 alphanumeric)
  - Rank references ("product #3", "rank 5")
  - Title matches (partial matching)
  ↓
Enforce max 2 ASINs per escalation
```

### Step 4: Credit Validation
```
Check:
  - Available credits >= required credits
  - Session limit not exceeded (10 credits)
  - Daily limit not exceeded (50 credits)
  ↓
If all pass → Proceed to escalation
If any fail → Block escalation, show insufficient credits message
```

### Step 5: Escalation Execution
```
For each ASIN:
  1. Check cache first (0 credits if cached)
  2. If not cached → Make type=product API call (1 credit)
  3. Cache result for future use
  4. Deduct credits
  ↓
Return product data + credit usage info
```

### Step 6: Context Injection
```
If escalation executed:
  - Inject product data into AI context
  - Show escalation message to user
  - AI uses escalated data to answer question
```

---

## Enforcement Rules

### ✅ Enforced Rules

1. **Never escalate for "accuracy" or "verification"**
   - Checked in `canAnswerWithPage1Data()` function
   - Questions about revenue/units use estimates, not escalation

2. **Max 2 ASINs per escalation**
   - Enforced in `extractAsinsFromQuestion()` with `.slice(0, 2)`

3. **Cache-first lookup**
   - Implemented in `executeEscalation()` function
   - Checks cache before making API calls

4. **Credit balance check before escalation**
   - Checked in `decideEscalation()` function
   - Validates available credits, session limit, daily limit

5. **Explicit escalation messaging**
   - `buildEscalationMessage()` shows credit cost
   - Message prepended to user question in chat

6. **Never silently call APIs**
   - All escalations logged with `console.log("ESCALATION_EXECUTED")`
   - Escalation message shown to user before API call

### ⚠️ Placeholder Implementations (Step 5)

The following functions are placeholders and will be fully implemented in Step 5 (database setup):

- `checkCreditBalance()` - Currently returns default values
- `checkCacheForAsins()` - Currently returns empty cache
- `cacheProductDetails()` - Currently no-op
- `deductCredits()` - Currently logs only

**These will be implemented when:**
- `user_credits` table is created
- `credit_transactions` table is created
- `credit_usage_log` table is created
- `asin_product_cache` table is created

---

## Behavior Branches

### Branch 1: Answerable from Page-1
```
Question → can_answer_from_page1 = true
  ↓
Answer immediately using Page-1 data
  ↓
No API calls, no credits used
```

### Branch 2: Escalation Required + Credits Available
```
Question → requires_escalation = true
Credits available → Execute escalation
  ↓
Show: "Looking up product details for [ASIN]... (1 credit)"
  ↓
Make API call(s), deduct credits
  ↓
Inject product data into AI context
  ↓
Answer using escalated data
```

### Branch 3: Escalation Required + Credits Unavailable
```
Question → requires_escalation = true
Credits unavailable → Block escalation
  ↓
Show: "I can't look up detailed product information right now because you don't have enough credits..."
  ↓
Offer alternatives:
  - Ask questions about Page-1 data (free)
  - Compare products using available data (free)
  - Get strategic advice based on market structure (free)
  ↓
Answer using Page-1 data only (qualitative reasoning)
```

---

## Example Scenarios

### Scenario 1: Market Structure Question (No Escalation)
```
User: "How competitive is this market?"
  ↓
decideEscalation() → can_answer_from_page1 = true
  ↓
Answer using market_structure, brand_moat, review_barrier
  ↓
No API calls, 0 credits
```

### Scenario 2: Product Specs Question (Escalation Required)
```
User: "What are the dimensions of product B0973DGD8P?"
  ↓
decideEscalation() → requires_escalation = true, required_asins = ["B0973DGD8P"]
  ↓
Check credits → available_credits = 5, required_credits = 1 ✅
  ↓
Check cache → Not cached
  ↓
Show: "Looking up product details for B0973DGD8P... (1 credit)"
  ↓
Make type=product API call → Get dimensions
  ↓
Cache result, deduct 1 credit
  ↓
Inject dimensions into AI context
  ↓
Answer: "The product dimensions are 8.5 x 6.2 x 2.1 inches."
```

### Scenario 3: Insufficient Credits
```
User: "What are the dimensions of product B0973DGD8P?"
  ↓
decideEscalation() → requires_escalation = true, required_asins = ["B0973DGD8P"]
  ↓
Check credits → available_credits = 0, required_credits = 1 ❌
  ↓
Show: "I can't look up detailed product information right now because you don't have enough credits..."
  ↓
Answer using Page-1 data only (qualitative reasoning)
```

---

## Logging & Debugging

### Escalation Decision Log
```
ESCALATION_DECISION {
  question: string,
  requires_escalation: boolean,
  can_answer_from_page1: boolean,
  required_asins: string[],
  required_credits: number,
  available_credits: number
}
```

### Escalation Execution Log
```
ESCALATION_EXECUTED {
  asins: string[],
  credits_used: number,
  cached: boolean[]
}
```

### Escalation Error Log
```
ESCALATION_ERROR {
  error: Error
}
```

---

## Next Steps (Step 5)

To complete the implementation, the following database tables need to be created:

1. **`user_credits`** - Store credit balances
2. **`credit_transactions`** - Log all credit transactions
3. **`credit_usage_log`** - Track credit usage per escalation
4. **`asin_product_cache`** - Cache product details to avoid repeat API calls

Once these tables exist, update the placeholder functions in `copilotEscalationHelpers.ts` to use real database queries.

---

## Testing Checklist

- [ ] Market structure questions answered without escalation
- [ ] Product comparison questions answered without escalation
- [ ] Revenue/units questions answered with estimates (no escalation)
- [ ] Product specs questions trigger escalation
- [ ] Escalation blocked when credits insufficient
- [ ] Escalation blocked when session limit exceeded
- [ ] Escalation blocked when daily limit exceeded
- [ ] Max 2 ASINs enforced
- [ ] Cache checked before API calls
- [ ] Credits deducted after escalation
- [ ] Escalation message shown to user
- [ ] Product data injected into AI context

---

**END OF IMPLEMENTATION SUMMARY**

