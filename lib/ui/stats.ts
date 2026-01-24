/**
 * Statistical utility functions
 */

/**
 * Calculate the median of an array of numbers
 * @param numbers - Array of numbers (will be filtered to valid numbers and sorted)
 * @returns The median value, or null if no valid numbers
 */
export function median(numbers: number[]): number | null {
  if (!Array.isArray(numbers) || numbers.length === 0) {
    return null;
  }

  // Filter to valid numbers (exclude null, undefined, NaN, Infinity)
  const validNumbers = numbers
    .filter((n): n is number => typeof n === 'number' && !isNaN(n) && isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  if (validNumbers.length === 0) {
    return null;
  }

  const mid = Math.floor(validNumbers.length / 2);

  if (validNumbers.length % 2 === 0) {
    // Even number of elements: average the two middle values
    return (validNumbers[mid - 1] + validNumbers[mid]) / 2;
  } else {
    // Odd number of elements: return the middle value
    return validNumbers[mid];
  }
}

