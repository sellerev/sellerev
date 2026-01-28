/**
 * Shared Pending Actions Cache
 * Stores pending actions for chat follow-up questions (e.g., "fetch review snippets")
 */

export interface PendingAction {
  type: "rainforest_reviews";
  asins: string[];
  limit: number;
  created_at: number;
  expires_at: number;
}

const pendingActionsCache = new Map<string, PendingAction>();

export function setPendingAction(analysisRunId: string, action: PendingAction): void {
  pendingActionsCache.set(analysisRunId, action);
  console.log("PENDING_ACTION_SET", {
    analysis_run_id: analysisRunId,
    action_type: action.type,
    asins: action.asins,
    limit: action.limit,
    expires_at: new Date(action.expires_at).toISOString(),
  });
}

export function getPendingAction(analysisRunId: string): PendingAction | null {
  const action = pendingActionsCache.get(analysisRunId);
  if (!action) return null;
  
  // Check expiration
  if (Date.now() > action.expires_at) {
    pendingActionsCache.delete(analysisRunId);
    console.log("PENDING_ACTION_EXPIRED", { analysis_run_id: analysisRunId });
    return null;
  }
  
  return action;
}

export function clearPendingAction(analysisRunId: string): void {
  const existed = pendingActionsCache.delete(analysisRunId);
  if (existed) {
    console.log("PENDING_ACTION_CLEARED", { analysis_run_id: analysisRunId });
  }
}

export function isAffirmation(message: string): boolean {
  const normalized = message.toLowerCase().trim();
  const affirmations = [
    'yes', 'yep', 'yeah', 'y', 'ok', 'okay', 'sure', 'do it', 'go ahead',
    'please', 'fetch', 'get', 'pull', 'retrieve', 'show me', 'i want',
    'sounds good', 'that works', 'go for it', 'proceed'
  ];
  return affirmations.some(aff => normalized === aff || normalized.startsWith(aff + ' ') || normalized.endsWith(' ' + aff));
}
