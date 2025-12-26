/**
 * Refresh Strategy
 * 
 * Determines when keywords should be refreshed based on priority and age.
 */

const REFRESH_INTERVALS: Record<string, number> = {
  'high': 3,      // Priority >= 8: 3 days
  'medium': 7,    // Priority 5-7: 7 days
  'low': 14,      // Priority < 5: 14 days
};

/**
 * Get refresh interval in days based on priority
 */
export function getRefreshIntervalDays(priority: number): number {
  if (priority >= 8) {
    return REFRESH_INTERVALS.high;
  } else if (priority >= 5) {
    return REFRESH_INTERVALS.medium;
  } else {
    return REFRESH_INTERVALS.low;
  }
}

/**
 * Check if keyword needs refresh based on priority and last update
 */
export function needsRefresh(
  lastUpdated: Date | string,
  priority: number
): boolean {
  const lastUpdatedDate = typeof lastUpdated === 'string' 
    ? new Date(lastUpdated) 
    : lastUpdated;
  
  const intervalDays = getRefreshIntervalDays(priority);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - intervalDays);

  return lastUpdatedDate < cutoffDate;
}

/**
 * Recalculate priority based on search count and other factors
 * (Simplified V1 - can be enhanced later)
 */
export function calculatePriority(searchCount: number): number {
  // Simple priority calculation based on search count
  // Can be enhanced with more sophisticated logic later
  if (searchCount >= 100) return 9;
  if (searchCount >= 50) return 8;
  if (searchCount >= 20) return 7;
  if (searchCount >= 10) return 6;
  if (searchCount >= 5) return 5;
  return 4;
}

