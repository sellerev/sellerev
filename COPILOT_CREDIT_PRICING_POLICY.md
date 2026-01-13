# Copilot Credit & Pricing Policy (Frozen)

**Version:** 1.0  
**Status:** FROZEN — This policy defines the exact credit model for Copilot escalations  
**Last Updated:** 2024

---

## Executive Summary

This document defines the **exact credit model** for Copilot escalations. Credits are only consumed when Copilot makes `type=product` API calls to fetch detailed product information beyond Page-1 data. **Page-1 analysis, reasoning, and all non-escalation interactions are always free.**

**Core Principle:** Credits must feel fair, predictable, and seller-friendly. Small sellers should feel safe experimenting, while heavy users naturally upgrade. No hidden costs, no surprise charges.

---

## 1. Copilot Credit Unit Definition

### 1.1 What Costs 1 Credit?

**1 Credit = 1 Rainforest API `type=product` call**

- Each `type=product` API call consumes exactly **1 credit**
- Multiple ASINs in a single batch call still consume **1 credit per ASIN**
- Maximum 2 ASINs per escalation (per escalation policy)
- **Example:** Comparing 2 products = 2 credits (2 separate `type=product` calls)

### 1.2 What Does NOT Cost Credits?

**The following are ALWAYS FREE:**

- ✅ **Page-1 analysis** (`type=search` API calls)
- ✅ **All reasoning and AI responses** (using Page-1 data)
- ✅ **Market snapshot analysis** (aggregates, estimates, rankings)
- ✅ **Product comparisons** (using Page-1 product card fields)
- ✅ **Strategic questions** (answered with market structure data)
- ✅ **Estimation questions** (using estimated fields from Page-1)
- ✅ **Algorithm boost insights** (using Page-1 signals)
- ✅ **All chat interactions** (unless escalation is triggered)

### 1.3 Credit Consumption Examples

| Action | Credits | Explanation |
|--------|---------|-------------|
| User asks "How competitive is this market?" | 0 | Answered with Page-1 market structure data |
| User asks "Compare product A vs product B" | 0 | Answered with Page-1 product card fields |
| User asks "What are the dimensions of product X?" | 1 | Requires `type=product` call (specifications not in Page-1) |
| User asks "Compare dimensions of product A vs B" | 2 | Requires 2 `type=product` calls (2 ASINs) |
| User asks "What color options does X have?" | 1 | Requires `type=product` call (variations not in Page-1) |
| User asks "How much revenue does X make?" | 0 | Answered with `estimated_monthly_revenue` from Page-1 |

---

## 2. Free Usage Tiers

### 2.1 New User Free Credits

**Every new user receives:**
- **10 free escalation credits** (one-time, upon account creation)
- **Purpose:** Allow sellers to experiment with Copilot escalations
- **Expiration:** Credits never expire (no time limit)
- **Usage:** Can be used at any time, for any escalation

### 2.2 Free Credit Allocation

**When credits are allocated:**
- Automatically upon account creation
- Credited immediately to user's account
- Visible in user dashboard/account settings
- Tracked in `user_credits` table (to be created)

**Credit balance display:**
- Show remaining free credits in UI
- Update in real-time after each escalation
- Clear messaging: "X free credits remaining"

### 2.3 What Happens When Free Credits Are Exhausted?

**When user has 0 credits remaining:**

1. **Copilot checks credit balance before escalation:**
   - If credits < required credits → Escalation is blocked
   - User is notified: "You need X credits to look up this information. Purchase credits to continue."

2. **Copilot continues to work normally:**
   - All Page-1 questions still answered (free)
   - All reasoning and analysis still available (free)
   - Only escalations requiring `type=product` calls are blocked

3. **User is prompted to purchase credits:**
   - Clear call-to-action: "Purchase Credits" button
   - Link to credit purchase page
   - Show credit pack options and pricing

**No forced upgrades, no paywalls for free features.**

---

## 3. Paid Credit Packs

### 3.1 Credit Bundle Sizes

**Three bundle sizes designed for different usage patterns:**

| Bundle | Credits | Price | Price per Credit | Best For |
|--------|---------|-------|------------------|----------|
| **Starter** | 25 credits | $4.99 | $0.20/credit | Occasional deep-dives (1-2 per week) |
| **Professional** | 100 credits | $14.99 | $0.15/credit | Regular research (daily use) |
| **Power User** | 250 credits | $29.99 | $0.12/credit | Heavy research (multiple per day) |

**Pricing Philosophy:**
- Volume discounts encourage larger purchases
- Starter pack allows experimentation without commitment
- Professional pack targets regular users
- Power User pack targets heavy researchers

### 3.2 Credit Pack Features

**All credit packs include:**
- ✅ Credits never expire (no time limit)
- ✅ Use credits for any escalation (no restrictions)
- ✅ Credits stack with free credits (additive)
- ✅ One-time purchase (no subscription required)
- ✅ Instant activation (credits available immediately)

**Credit purchase flow:**
1. User clicks "Purchase Credits" (when credits exhausted or proactively)
2. Select credit pack (Starter/Professional/Power User)
3. Complete payment (Stripe integration)
4. Credits added to account immediately
5. User can continue using Copilot

### 3.3 Credit Pack Recommendations

**UI should suggest appropriate pack based on usage:**
- **New user:** Suggest Starter pack (25 credits)
- **Regular user (5-10 escalations/month):** Suggest Professional pack (100 credits)
- **Heavy user (20+ escalations/month):** Suggest Power User pack (250 credits)

**Show usage patterns:**
- "You've used X credits this month"
- "At this rate, you'll need Y credits per month"
- "Recommended: [Pack Name] for your usage level"

---

## 4. Subscription Tie-ins (Future)

### 4.1 Subscription Plans (To Be Defined)

**If subscription plans are introduced, they should include:**

| Plan | Monthly Price | Included Credits | Additional Credits | Best For |
|------|--------------|------------------|-------------------|----------|
| **Free** | $0 | 10 (one-time) | Purchase packs | New sellers exploring |
| **Pro** | $29/month | 50 credits/month | $0.15/credit | Regular sellers |
| **Business** | $99/month | 200 credits/month | $0.12/credit | Scaling brands |

**Subscription Credit Rules:**
- Monthly credits reset on billing date
- Unused credits do NOT roll over (use-it-or-lose-it)
- Additional credits can be purchased at pack rates
- Subscription credits stack with purchased credits

### 4.2 What Happens If User Exceeds Monthly Credits?

**When subscription credits are exhausted:**

1. **User can continue using:**
   - All free features (Page-1 analysis, reasoning)
   - Purchase additional credit packs (one-time)
   - Credits from packs stack with subscription credits

2. **User is notified:**
   - "You've used all 50 monthly credits"
   - "Purchase additional credits or wait for next month's reset"
   - Show credit pack options

3. **No forced upgrade:**
   - User can purchase credits without upgrading plan
   - Upgrading plan gives more monthly credits (better value)

**Note:** Subscription plans are future consideration. Current implementation focuses on one-time credit packs.

---

## 5. User-Facing Messaging

### 5.1 Pre-Escalation Messaging

**Before making any escalation API call, Copilot MUST:**

1. **Check credit balance:**
   - Verify user has sufficient credits
   - If insufficient → Block escalation and show message

2. **Notify user of credit cost:**
   - Show exact credit cost: "This lookup will cost 1 credit" or "This lookup will cost 2 credits"
   - Show remaining balance: "You have X credits remaining"
   - Show what will be looked up: "Looking up product details for [ASIN]..."

3. **Get implicit consent:**
   - User proceeds with question = consent to use credits
   - No explicit confirmation required (smooth UX)
   - Clear messaging ensures user understands cost

### 5.2 Exact Language Patterns

**Standard escalation messages:**

| Scenario | Message |
|----------|---------|
| **Single ASIN escalation** | "Looking up product details for [ASIN]... (1 credit)" |
| **Two ASIN escalation** | "Looking up product details for [ASIN 1] and [ASIN 2]... (2 credits)" |
| **Insufficient credits (single)** | "This lookup requires 1 credit. You have 0 credits remaining. [Purchase Credits]" |
| **Insufficient credits (double)** | "This lookup requires 2 credits. You have 1 credit remaining. [Purchase Credits]" |
| **After escalation** | "Product details retrieved. You have X credits remaining." |

**Credit balance display:**
- Always visible in chat sidebar: "Credits: X remaining"
- Update in real-time after each escalation
- Show in account settings: "Total Credits: X"

### 5.3 Escalation Decline Messages

**When Copilot cannot escalate (no credits):**

**Message Template:**
```
I can't look up detailed product information right now because you don't have enough credits.

This lookup would cost [X] credits, but you have [Y] credits remaining.

You can still:
- Ask questions about Page-1 data (free)
- Compare products using available data (free)
- Get strategic advice based on market structure (free)

To look up detailed product information, purchase credits:
[Purchase Credits Button]
```

**Alternative (if question can be partially answered):**
```
I can't look up the exact dimensions, but I can tell you from Page-1 data:
- Product X is ranked #3
- Price: $24.99
- Reviews: 2,400
- Estimated revenue: $12,450/month

For detailed specifications, I'd need to look up the product (1 credit). 
You have 0 credits remaining. [Purchase Credits]
```

---

## 6. Guardrails & Safety Limits

### 6.1 Per-Session Limits

**Maximum credits per chat session:**
- **Limit:** 10 credits per chat session
- **Purpose:** Prevent runaway costs from accidental loops
- **Reset:** When user starts new chat session (new analysis)
- **Message:** "You've used 10 credits this session. Start a new analysis to continue."

**Session definition:**
- One chat session = One analysis run + all follow-up questions
- New analysis = New session (limit resets)
- Session limit prevents accidental multi-escalation loops

### 6.2 Per-Day Limits

**Maximum credits per day:**
- **Limit:** 50 credits per day (24-hour rolling window)
- **Purpose:** Prevent abuse and runaway costs
- **Reset:** Rolling 24-hour window (not calendar day)
- **Message:** "You've reached the daily limit of 50 credits. Try again tomorrow."

**Daily limit calculation:**
- Track credits used in last 24 hours
- Block escalation if limit reached
- Show time until next credit available: "Next credit available in 3 hours"

### 6.3 Multi-ASIN Escalation Prevention

**Prevent accidental multi-ASIN escalations:**

1. **Explicit ASIN identification:**
   - Copilot must identify exactly which ASINs are needed
   - Maximum 2 ASINs per escalation (per policy)
   - Show both ASINs in pre-escalation message

2. **Confirmation for 2-ASIN escalations:**
   - For 2-ASIN escalations, show: "This will look up 2 products (2 credits). Continue?"
   - User can proceed or cancel
   - Prevents accidental double-charges

3. **Cache check before escalation:**
   - Check if ASIN data is already cached
   - If cached → Use cached data (0 credits)
   - Only escalate if data not in cache

### 6.4 Credit Balance Validation

**Before every escalation, validate:**
- ✅ User has sufficient credits for requested escalation
- ✅ Session limit not exceeded (10 credits)
- ✅ Daily limit not exceeded (50 credits)
- ✅ Maximum ASINs not exceeded (2 ASINs)
- ✅ Data not already cached (check cache first)

**If any validation fails:**
- Block escalation
- Show appropriate error message
- Suggest alternatives (use Page-1 data, purchase credits, etc.)

---

## 7. Credit Tracking & Accounting

### 7.1 Credit Balance Storage

**Database schema (to be created):**

```sql
CREATE TABLE user_credits (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  free_credits INTEGER DEFAULT 10, -- One-time free credits
  purchased_credits INTEGER DEFAULT 0, -- Credits from packs
  subscription_credits INTEGER DEFAULT 0, -- Monthly subscription credits (future)
  used_credits INTEGER DEFAULT 0, -- Total credits used (lifetime)
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  transaction_type TEXT NOT NULL, -- 'free_allocated', 'purchased', 'used', 'subscription'
  credits INTEGER NOT NULL, -- Positive for additions, negative for usage
  pack_id TEXT, -- If purchased, which pack
  payment_id TEXT, -- If purchased, Stripe payment ID
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE credit_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  analysis_run_id UUID REFERENCES analysis_runs(id),
  asin TEXT NOT NULL,
  credits_used INTEGER DEFAULT 1,
  cached BOOLEAN DEFAULT FALSE, -- True if data was cached (0 credits)
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 7.2 Credit Calculation

**Total available credits:**
```
Available Credits = free_credits + purchased_credits + subscription_credits - used_credits
```

**Credit usage tracking:**
- Each escalation logs to `credit_usage_log`
- Increment `used_credits` in `user_credits`
- Log transaction to `credit_transactions` (negative amount)

**Credit allocation tracking:**
- Free credits: Log as `transaction_type = 'free_allocated'` (positive)
- Purchased credits: Log as `transaction_type = 'purchased'` (positive)
- Subscription credits: Log as `transaction_type = 'subscription'` (positive, monthly)

### 7.3 Credit Balance Queries

**Real-time balance check:**
```sql
SELECT 
  (free_credits + purchased_credits + subscription_credits - used_credits) as available_credits,
  free_credits,
  purchased_credits,
  subscription_credits,
  used_credits
FROM user_credits
WHERE user_id = $1;
```

**Daily usage check:**
```sql
SELECT SUM(credits_used) as daily_credits
FROM credit_usage_log
WHERE user_id = $1
  AND created_at >= NOW() - INTERVAL '24 hours';
```

**Session usage check:**
```sql
SELECT SUM(credits_used) as session_credits
FROM credit_usage_log
WHERE user_id = $1
  AND analysis_run_id = $2;
```

---

## 8. Implementation Checklist

### 8.1 Database Setup
- [ ] Create `user_credits` table
- [ ] Create `credit_transactions` table
- [ ] Create `credit_usage_log` table
- [ ] Add migration to allocate 10 free credits to all existing users
- [ ] Add trigger to auto-allocate 10 free credits to new users

### 8.2 Credit Management Functions
- [ ] `checkCreditBalance(userId)` - Returns available credits
- [ ] `useCredits(userId, credits, asin, analysisRunId)` - Deducts credits and logs usage
- [ ] `allocateFreeCredits(userId)` - Allocates 10 free credits to new user
- [ ] `purchaseCredits(userId, packId, paymentId)` - Adds purchased credits
- [ ] `checkDailyLimit(userId)` - Returns true if daily limit not exceeded
- [ ] `checkSessionLimit(userId, analysisRunId)` - Returns true if session limit not exceeded

### 8.3 Escalation Integration
- [ ] Add credit check before escalation in `app/api/chat/route.ts`
- [ ] Add pre-escalation messaging (show credit cost)
- [ ] Add credit deduction after successful escalation
- [ ] Add cache check before escalation (use cached data if available)
- [ ] Add error handling for insufficient credits

### 8.4 UI Components
- [ ] Credit balance display in chat sidebar
- [ ] Credit balance display in account settings
- [ ] Credit purchase page (pack selection, Stripe integration)
- [ ] Credit usage history page
- [ ] Pre-escalation notification component
- [ ] Insufficient credits error component

### 8.5 Payment Integration
- [ ] Stripe integration for credit pack purchases
- [ ] Webhook handler for payment confirmation
- [ ] Credit allocation after successful payment
- [ ] Receipt generation for credit purchases

---

## 9. Pricing Rationale

### 9.1 Cost Basis

**Rainforest API costs:**
- `type=product` call: ~$0.0083 per call (based on Rainforest pricing)
- Our margin: ~$0.20 per credit (Starter pack) = 24x markup
- Our margin: ~$0.12 per credit (Power User pack) = 14x markup

**Why the markup:**
- Infrastructure costs (API handling, caching, database)
- Support and maintenance
- Platform development
- Profit margin for sustainability

### 9.2 Competitive Positioning

**Compared to alternatives:**
- Helium 10: $39-99/month (unlimited usage, but locked to subscription)
- Jungle Scout: $49-129/month (unlimited usage, but locked to subscription)
- Sellerev: Pay-per-use credits (no subscription required, use when needed)

**Value proposition:**
- No subscription commitment
- Pay only for deep-dives
- Free Page-1 analysis (competitors charge for this)
- Transparent pricing (no hidden costs)

### 9.3 Seller-Friendly Design

**Why this model works:**
- **New sellers:** 10 free credits let them experiment without risk
- **Occasional users:** Starter pack ($4.99) is affordable for occasional deep-dives
- **Regular users:** Professional pack ($14.99) provides good value for daily use
- **Heavy users:** Power User pack ($29.99) offers best value for frequent research

**No pressure to upgrade:**
- Free features remain free forever
- Credits never expire
- No forced subscriptions
- Transparent pricing

---

## 10. Version History

- **v1.0 (2024)**: Initial frozen credit & pricing policy
  - Defines credit unit (1 credit = 1 `type=product` call)
  - Defines free usage (10 credits for new users)
  - Defines paid credit packs (Starter/Professional/Power User)
  - Defines user-facing messaging
  - Defines guardrails (session/daily limits)
  - Defines credit tracking schema

---

**END OF CREDIT & PRICING POLICY**

