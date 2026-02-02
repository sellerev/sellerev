/**
 * Grounded Copilot: FACTS_ALLOWED block and grounding rules for the system prompt.
 * Enforces no numbers unless present, evidence per claim, no invented labels.
 */

import type { FactsAllowed } from "./copilotFacts";

export const COPILOT_JSON_SCHEMA = `{
  "headline": "string",
  "observations": [
    {
      "claim": "string",
      "evidence": ["string", "string"]
    }
  ],
  "constraints": ["string"],
  "followup_question": "string",
  "confidence": "high|medium|low",
  "used_sources": {
    "page1": true,
    "rainforest": false,
    "spapi": false
  }
}`;

export function buildFactsAllowedBlock(facts: FactsAllowed): string {
  return `=== FACTS_ALLOWED (ONLY SOURCE OF TRUTH — NO OTHER NUMBERS) ===
You may ONLY use the following data. Any number (price, review count, revenue, share, count) must appear here. If not present, write "Not available in current data."

${JSON.stringify(facts, null, 2)}

CRITICAL: Cite which part of FACTS_ALLOWED you used for each claim (e.g. "Evidence: Sponsored 7 / 23 listings (from page1.snapshot)").`;
}

export const GROUNDING_RULES = `
GROUNDING RULES (MANDATORY):
- Numbers rule: You may only use numbers (prices, reviews, revenue, shares, counts) if they appear in FACTS_ALLOWED. If not present, write "Not available in current data."
- Evidence rule: Every market claim must include at least one evidence bullet citing which metric(s) it used from FACTS_ALLOWED.
- No invented labels: Never invent categories, labels, ranks. If classification is not computed, phrase as: "My read based on page-1 signals: …"
- Uncertainty language: Use "suggests / likely / based on page-1 only" for inferences. Avoid absolute language like "requires ALL…"
- No fragments: End with one clear followup question. No sentence fragments, no dangling "Would you like…"
- Max bullets: max 4 observations, max 4 constraints.
- If the user asks for "proof" or "why", include evidence strings like: "Evidence: Sponsored 7 / 23 listings (from page1.snapshot)"
- If Rainforest/SP-API was used (or cache hit), used_sources must reflect that and evidence strings must mention e.g. "From Rainforest type=product dossier fetched {date}" or "From cached dossier (7-day cache)".
`.trim();

export function buildGroundedSystemInstructions(
  facts: FactsAllowed,
  sourceMode: "page1_only" | "dossier_needed" | "fees_needed"
): string {
  const factsBlock = buildFactsAllowedBlock(facts);
  const modeNote =
    sourceMode === "page1_only"
      ? "Answer using ONLY Page-1 data above. Do NOT call or assume any Rainforest or SP-API data."
      : sourceMode === "dossier_needed"
        ? "You may use product dossiers or reviews in FACTS_ALLOWED.enrichments if present; cite source and date."
        : "You may use fees data in FACTS_ALLOWED.enrichments.fees if present; cite source.";
  return [factsBlock, modeNote, GROUNDING_RULES].join("\n\n");
}
