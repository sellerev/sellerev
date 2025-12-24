/**
 * Memory Extraction System
 * 
 * Extracts durable, factual information about sellers from:
 * - User statements in chat
 * - Uploaded attachments
 * - Onboarding data
 * 
 * STRICT RULES:
 * - Only stores facts, not opinions
 * - Only stores business operations, constraints, preferences
 * - Never stores market analysis or recommendations
 */

export interface ExtractedMemory {
  memory_type: 'sourcing' | 'costs' | 'pricing' | 'logistics' | 'constraints' | 'preferences' | 'goals' | 'experience' | 'assets' | 'strategy';
  key: string;
  value: Record<string, unknown> | string | number | boolean | null;
  confidence: 'low' | 'medium' | 'high';
  source: 'onboarding' | 'explicit_user_statement' | 'attachment_extraction' | 'ai_inference';
}

/**
 * Memory Extraction System Prompt (WORD-FOR-WORD)
 * 
 * This is the exact system prompt used ONLY when:
 * - User uploads an attachment
 * - User states something about their business
 * - AI needs to update memory
 */
export const MEMORY_EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction engine for an Amazon seller assistant.

Your job is to extract ONLY durable, factual information about the seller's business that should persist across sessions.

STRICT RULES:

- Do NOT summarize.
- Do NOT store opinions, speculation, or one-off thoughts.
- Do NOT store market analysis conclusions.
- ONLY extract information that describes how the seller operates, their constraints, preferences, or assets.
- If information is uncertain, mark confidence as "low".
- If information is explicitly stated by the user, mark confidence as "high".
- If inferred, mark confidence as "medium" and source as "ai_inference".

ALLOWED MEMORY TYPES:

- sourcing
- costs
- pricing
- logistics
- constraints
- preferences
- goals
- experience
- assets
- strategy

OUTPUT FORMAT (JSON OBJECT):

You must return a JSON object with a "memories" array:

{
  "memories": [
    {
      "memory_type": "",
      "key": "",
      "value": {},
      "confidence": "low | medium | high",
      "source": "onboarding | explicit_user_statement | attachment_extraction | ai_inference"
    }
  ]
}

If no valid memory is found, return: { "memories": [] }

EXAMPLES OF WHAT TO STORE:

- Sourcing country or method
- Typical cost ranges or MOQs
- Capital constraints
- Category exclusions
- Business goals or timelines
- Operational preferences (bundles, FBA, etc.)

EXAMPLES OF WHAT NOT TO STORE:

- "This niche looks bad"
- "I like this product"
- Market conclusions
- AI recommendations
- Temporary scenarios

If no valid memory is found, return: { "memories": [] }`;

/**
 * Canonical Memory Keys
 * 
 * These are the only keys supported at launch.
 * All keys must be expressible cleanly in JSON.
 */
export const CANONICAL_MEMORY_KEYS = {
  // Sourcing
  PRIMARY_SOURCING_COUNTRY: 'primary_sourcing_country',
  BACKUP_SOURCING_COUNTRY: 'backup_sourcing_country',
  USES_WHOLESALE: 'uses_wholesale',
  USES_PRIVATE_LABEL: 'uses_private_label',
  
  // Costs
  TYPICAL_COGS_PERCENT: 'typical_cogs_percent',
  TARGET_LANDED_COST_RANGE: 'target_landed_cost_range',
  COMFORTABLE_MOQ: 'comfortable_moq',
  
  // Logistics
  MAX_UNIT_WEIGHT_LBS: 'max_unit_weight_lbs',
  PREFERRED_SIZE_TIER: 'preferred_size_tier',
  USES_FBA: 'uses_fba',
  
  // Constraints
  AVOIDED_CATEGORIES: 'avoided_categories',
  CAPITAL_LIMIT_USD: 'capital_limit_usd',
  LAUNCH_TIME_HORIZON_DAYS: 'launch_time_horizon_days',
  
  // Goals
  PRIMARY_GOAL: 'primary_goal',
  MONTHLY_PROFIT_TARGET: 'monthly_profit_target',
  
  // Strategy / Preferences
  PREFERS_BUNDLES: 'prefers_bundles',
  RISK_TOLERANCE: 'risk_tolerance',
  DEFENSIBILITY_PRIORITY: 'defensibility_priority',
} as const;

/**
 * Extract memories from user input using AI
 */
export async function extractMemoriesFromText(
  userText: string,
  source: 'explicit_user_statement' | 'attachment_extraction' | 'ai_inference' = 'explicit_user_statement'
): Promise<ExtractedMemory[]> {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    console.error("OpenAI API key not configured");
    return [];
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: MEMORY_EXTRACTION_SYSTEM_PROMPT },
          { role: "user", content: userText },
        ],
        temperature: 0.3, // Lower temperature for more consistent extraction
        response_format: { type: "json_object" },
        // Request structured output with memories array
        // Note: OpenAI may return { memories: [...] } or direct array
      }),
    });

    if (!response.ok) {
      console.error("Memory extraction API error:", response.statusText);
      return [];
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      return [];
    }

    // Parse JSON response
    // OpenAI with json_object format returns an object, not an array
    const parsed = JSON.parse(content);
    
    // Handle both { memories: [...] } and direct array formats
    // If OpenAI returns an object, look for 'memories' key or assume it's the array
    const memories = Array.isArray(parsed) 
      ? parsed 
      : (parsed.memories && Array.isArray(parsed.memories))
        ? parsed.memories
        : (parsed.memory && Array.isArray(parsed.memory))
          ? parsed.memory
          : [];
    
    // Validate and set source
    return memories
      .filter((m: any) => 
        m.memory_type && 
        m.key && 
        m.value !== undefined && 
        m.confidence && 
        ['low', 'medium', 'high'].includes(m.confidence)
      )
      .map((m: any) => ({
        ...m,
        source: m.source || source, // Use provided source or default
      })) as ExtractedMemory[];
  } catch (error) {
    console.error("Memory extraction error:", error);
    return [];
  }
}

/**
 * Validate memory key against canonical keys
 */
export function isValidMemoryKey(key: string): boolean {
  return Object.values(CANONICAL_MEMORY_KEYS).includes(key as any);
}

/**
 * Build seller memory context string for AI prompts
 * 
 * Returns a clean, readable summary of relevant memories
 */
export function buildSellerMemoryContext(memories: Array<{
  memory_type: string;
  key: string;
  value: unknown;
}>): string {
  const grouped: Record<string, Record<string, unknown>> = {};
  
  // Group by memory_type
  for (const memory of memories) {
    if (!grouped[memory.memory_type]) {
      grouped[memory.memory_type] = {};
    }
    grouped[memory.memory_type][memory.key] = memory.value;
  }
  
  const parts: string[] = [];
  
  // Sourcing
  if (grouped.sourcing) {
    const sourcing = grouped.sourcing;
    const parts2: string[] = [];
    if (sourcing.primary_sourcing_country) parts2.push(`${sourcing.primary_sourcing_country}`);
    if (sourcing.uses_private_label) parts2.push("Private Label");
    if (sourcing.uses_wholesale) parts2.push("Wholesale");
    if (parts2.length > 0) {
      parts.push(`Sourcing: ${parts2.join(", ")}`);
    }
  }
  
  // Costs
  if (grouped.costs) {
    const costs = grouped.costs;
    const parts2: string[] = [];
    if (costs.typical_cogs_percent) parts2.push(`~${Math.round((costs.typical_cogs_percent as number) * 100)}% COGS`);
    if (costs.comfortable_moq) parts2.push(`MOQ: ${costs.comfortable_moq}`);
    if (parts2.length > 0) {
      parts.push(`Costs: ${parts2.join(", ")}`);
    }
  }
  
  // Constraints
  if (grouped.constraints) {
    const constraints = grouped.constraints;
    const parts2: string[] = [];
    if (constraints.capital_limit_usd) parts2.push(`Capital: $${(constraints.capital_limit_usd as number).toLocaleString()}`);
    if (constraints.avoided_categories && Array.isArray(constraints.avoided_categories)) {
      parts2.push(`Avoids: ${(constraints.avoided_categories as string[]).join(", ")}`);
    }
    if (parts2.length > 0) {
      parts.push(`Constraints: ${parts2.join(", ")}`);
    }
  }
  
  // Goals
  if (grouped.goals) {
    const goals = grouped.goals;
    if (goals.primary_goal) {
      parts.push(`Goal: ${goals.primary_goal}`);
    }
  }
  
  // Preferences
  if (grouped.preferences) {
    const prefs = grouped.preferences;
    if (prefs.risk_tolerance) {
      parts.push(`Risk Tolerance: ${prefs.risk_tolerance}`);
    }
  }
  
  if (parts.length === 0) {
    return "";
  }
  
  return `Seller Business Context:\n${parts.map(p => `- ${p}`).join("\n")}`;
}
