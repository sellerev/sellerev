/**
 * Usage Limit Management
 * 
 * Handles usage limit checks and increments with developer/admin bypass.
 * 
 * BYPASS RULES:
 * - Development mode: All users bypass limits
 * - Admin emails: Specific users bypass limits
 * - Production normal users: Limits apply
 */

const ADMIN_EMAILS = [
  "shane-mosoff@hotmail.com",
];

export interface UsageCheckResult {
  allowed: boolean;
  remaining: number;
}

/**
 * Checks if a user should bypass usage limits.
 * 
 * @param userEmail - User's email address
 * @returns true if user should bypass limits, false otherwise
 */
function shouldBypassLimits(userEmail: string | null | undefined): boolean {
  // Development mode: bypass for all users
  if (process.env.NODE_ENV === "development") {
    return true;
  }

  // Admin emails: bypass for specific users
  if (userEmail && ADMIN_EMAILS.includes(userEmail.toLowerCase())) {
    return true;
  }

  return false;
}

/**
 * Checks usage limits for a user.
 * 
 * @param userId - User ID to check
 * @param userEmail - User's email address
 * @param currentCount - Current usage count
 * @param maxCount - Maximum allowed count
 * @returns UsageCheckResult indicating if usage is allowed and remaining count
 */
export async function checkUsageLimit(
  userId: string,
  userEmail: string | null | undefined,
  currentCount: number,
  maxCount: number
): Promise<UsageCheckResult> {
  // Bypass for development or admin users
  if (shouldBypassLimits(userEmail)) {
    return {
      allowed: true,
      remaining: Infinity,
    };
  }

  // Normal usage limit check
  const remaining = Math.max(0, maxCount - currentCount);
  return {
    allowed: currentCount < maxCount,
    remaining,
  };
}

/**
 * Determines if usage counter should be incremented.
 * 
 * @param userEmail - User's email address
 * @returns true if counter should be incremented, false to skip
 */
export function shouldIncrementUsage(userEmail: string | null | undefined): boolean {
  // Do NOT increment for development or admin users
  return !shouldBypassLimits(userEmail);
}















