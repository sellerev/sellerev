/**
 * Normalize risks object to ensure it always has exactly 4 required keys
 * with the correct structure. Used to enforce stable AnalysisResponse contract.
 * 
 * This function ensures the risks field always matches the AnalysisResponse type:
 * {
 *   competition: RiskLevel;
 *   pricing: RiskLevel;
 *   differentiation: RiskLevel;
 *   operations: RiskLevel;
 * }
 */
export function normalizeRisks(
  risks: Record<string, { level: string; explanation: string }> | undefined
): {
  competition: { level: "Low" | "Medium" | "High"; explanation: string };
  pricing: { level: "Low" | "Medium" | "High"; explanation: string };
  differentiation: { level: "Low" | "Medium" | "High"; explanation: string };
  operations: { level: "Low" | "Medium" | "High"; explanation: string };
} {
  const defaultRisk = {
    level: "Medium" as const,
    explanation: "Insufficient data — conservative default.",
  };

  const validLevels = ["Low", "Medium", "High"];
  
  const getRisk = (key: string): { level: "Low" | "Medium" | "High"; explanation: string } => {
    if (!risks || typeof risks !== "object") {
      return defaultRisk;
    }

    const risk = risks[key];
    if (!risk || typeof risk !== "object") {
      return defaultRisk;
    }

    // Validate and normalize level
    let level: "Low" | "Medium" | "High" = "Medium";
    if (risk.level && validLevels.includes(risk.level)) {
      level = risk.level as "Low" | "Medium" | "High";
    }

    // Ensure explanation is a string
    const explanation = typeof risk.explanation === "string" && risk.explanation.trim().length > 0
      ? risk.explanation.trim()
      : defaultRisk.explanation;

    return { level, explanation };
  };

  return {
    competition: getRisk("competition"),
    pricing: getRisk("pricing"),
    differentiation: getRisk("differentiation"),
    operations: getRisk("operations"),
  };
}

