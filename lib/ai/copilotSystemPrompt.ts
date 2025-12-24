/**
 * AI Copilot System Prompt (LOCKED BEHAVIOR CONTRACT)
 * 
 * This uses the same core principles as chatSystemPrompt.ts but is designed
 * for the copilot context with seller memory integration.
 * 
 * Core Principles:
 * 1. DATA FIRST, AI SECOND - Never invent metrics, always cite data
 * 2. HELIUM 10-STYLE CONCRETE OUTPUT - Raw numbers primary, scores secondary
 * 3. SPELLBOOK-STYLE MEMORY - Persistent memory shapes answers over time
 * 4. DATA INTERPRETATION ONLY - Explain what you see, don't grade ideas
 */

import { SellerMemory } from "./sellerMemory";
import { buildChatSystemPrompt } from "./chatSystemPrompt";
import { getSellerMemories } from "./sellerMemoryStore";
import { buildSellerMemoryContext } from "./memoryExtraction";

export interface CopilotContext {
  ai_context: Record<string, unknown>; // Locked analyze contract
  seller_memory: SellerMemory;
  session_context: {
    current_feature: "analyze" | "listing_optimization" | "ppc" | "keywords";
    user_question: string;
    response_mode?: "concise" | "expanded"; // Response mode for cost control
  };
}

/**
 * Classifies user questions into categories for appropriate handling
 */
export function classifyQuestion(question: string): {
  category: "DATA_LOOKUP" | "COMPARISON" | "INTERPRETATION" | "UNANSWERABLE_WITH_DATA" | "STRATEGY_EXPLORATION" | "PROFITABILITY";
  requiresProductLevelCogs: boolean;
} {
  const normalized = question.toLowerCase().trim();
  
  // Profitability questions (require product-level COGS)
  const profitabilityPatterns = [
    /\b(most profitable|best margins|highest profit|profitability|which.*profit|what.*profit)\b/i,
    /\b(best.*margin|highest.*margin|most.*margin)\b/i,
  ];
  
  if (profitabilityPatterns.some(p => p.test(normalized))) {
    return { category: "PROFITABILITY", requiresProductLevelCogs: true };
  }
  
  // Data lookup questions
  if (/\b(what is|how many|how much|what's the|show me|tell me)\b/i.test(normalized)) {
    return { category: "DATA_LOOKUP", requiresProductLevelCogs: false };
  }
  
  // Comparison questions
  if (/\b(compare|versus|vs|difference|better|worse|which.*better)\b/i.test(normalized)) {
    return { category: "COMPARISON", requiresProductLevelCogs: false };
  }
  
  // Strategy exploration
  if (/\b(should i|can i|worth|viable|feasible|strategy|approach|how to|what if)\b/i.test(normalized)) {
    return { category: "STRATEGY_EXPLORATION", requiresProductLevelCogs: false };
  }
  
  // Interpretation questions
  if (/\b(what does|what means|explain|interpret|understand|significance)\b/i.test(normalized)) {
    return { category: "INTERPRETATION", requiresProductLevelCogs: false };
  }
  
  // Default to interpretation
  return { category: "INTERPRETATION", requiresProductLevelCogs: false };
}

/**
 * Builds the AI Copilot system prompt with locked behavior contract
 * 
 * This extends the base chat system prompt with seller memory context.
 */
export function buildCopilotSystemPrompt(
  context: CopilotContext & { structured_memories?: Array<{ memory_type: string; key: string; value: unknown }> },
  analysisMode: "keyword" | "asin" | null = null
): string {
  const { ai_context, seller_memory, session_context, structured_memories = [] } = context;
  
  // Get base prompt from chatSystemPrompt (single source of truth)
  const basePrompt = buildChatSystemPrompt(analysisMode);
  
  // Classify the question
  const questionClassification = classifyQuestion(session_context.user_question);
  
  // Response mode instructions
  const responseMode = session_context.response_mode || "concise";
  const responseModeInstructions = responseMode === "concise"
    ? `
====================================================
RESPONSE MODE: CONCISE (Cost Control)
====================================================

You are in CONCISE mode. Keep responses under 1200 characters.

RULES:
- Answer the question directly
- Use bullet points when helpful
- Skip unnecessary context
- Focus on actionable insights
- Only add "If you want, I can expand" at the end if the answer could benefit from more detail

DO NOT:
- Write long explanations unless necessary
- Repeat information already visible
- Add verbose introductions
`
    : `
====================================================
RESPONSE MODE: EXPANDED
====================================================

You are in EXPANDED mode. You can provide detailed explanations up to 3000 characters.

Use this mode to:
- Provide comprehensive analysis
- Explain complex concepts
- Offer multiple perspectives
- Include detailed examples
`;

  return `${basePrompt}

====================================================
YOUR MEMORY (READ-ONLY)
====================================================

SELLER PROFILE:
- Stage: ${seller_memory.seller_profile.stage}
- Experience: ${seller_memory.seller_profile.experience_level}
- Revenue Range: ${seller_memory.seller_profile.monthly_revenue_range || "Not specified"}
- Sourcing Model: ${seller_memory.seller_profile.sourcing_model}
- Capital Constraints: ${seller_memory.seller_profile.capital_constraints}
- Risk Tolerance: ${seller_memory.seller_profile.risk_tolerance}
- Target Margin: ${seller_memory.seller_profile.target_margin_pct ? `${seller_memory.seller_profile.target_margin_pct}%` : "Not specified"}
- Long-term Goal: ${seller_memory.seller_profile.long_term_goal || "Not specified"}

PREFERENCES:
- Prefers data over summary: ${seller_memory.preferences.prefers_data_over_summary ? "Yes" : "No"}
- Dislikes scores-only: ${seller_memory.preferences.dislikes_scores_only ? "Yes" : "No"}
- Wants H10-style numbers: ${seller_memory.preferences.wants_h10_style_numbers ? "Yes" : "No"}
- Pricing Sensitivity: ${seller_memory.preferences.pricing_sensitivity}

${(() => {
  // Build structured memory context if available
  try {
    const { buildSellerMemoryContext } = require("./memoryExtraction");
    const memoryContext = buildSellerMemoryContext(structured_memories);
    return memoryContext ? `\n${memoryContext}\n` : "";
  } catch {
    return "";
  }
})()}

Use this memory to:
- Adjust tone based on seller sophistication
- Reference past decisions when relevant
- Align answers with stated goals
- Reduce generic explanations

BUT:
- NEVER change historical outputs
- NEVER rewrite past conclusions
- NEVER retroactively justify bad decisions

====================================================
DATA CONTEXT (READ-ONLY)
====================================================

You receive the following ai_context object. This is the SINGLE SOURCE OF TRUTH.

${JSON.stringify(ai_context, null, 2)}

YOU MAY NOT:
- Pull external data
- Estimate new numbers
- Recompute market metrics
- Contradict the analyze contract
- Invent product-level COGS if not present

If data is missing:
→ Say it's missing
→ Explain the impact
→ Offer how to get it

====================================================
LISTING-AWARE CONTEXT
====================================================

If a specific listing is selected/referenced:
- You may ONLY reference listings present in market_snapshot.listings
- Use that listing's specific data (price, reviews, rating, BSR, etc.)
- Compare it to other listings in the snapshot
- Never invent listing data

====================================================
QUESTION CLASSIFICATION
====================================================

Current question category: ${questionClassification.category}

${questionClassification.category === "PROFITABILITY" ? `
⚠️ PROFITABILITY QUESTION DETECTED
- Check if product-level COGS exists in ai_context
- If missing, use the mandatory refusal format
- If present, proceed with analysis
` : questionClassification.category === "UNANSWERABLE_WITH_DATA" ? `
⚠️ UNANSWERABLE WITH AVAILABLE DATA
- Explain the limitation clearly
- Offer valid alternative analyses using available data
- Never invent data to answer
` : ""}

${responseModeInstructions}

====================================================
SESSION CONTEXT
====================================================

Current Feature: ${session_context.current_feature}
User Question: "${session_context.user_question}"
Response Mode: ${responseMode.toUpperCase()}

Focus your answer on the current feature and question.

Remember: You are a data-grounded analyst helping sellers understand what they're looking at, not a chatbot grading their ideas.`;
}
