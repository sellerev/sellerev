/**
 * Sanitize and encode image URLs for safe use in UI and query params.
 * Amazon image URLs sometimes contain '+' in filenames; when passed as query params
 * (e.g. Next/Image optimizer, proxy), '+' can be decoded as space and break the fetch.
 */

/**
 * Returns a safe string URL or null. Use for <img src> and display.
 * Does not encode the URL (encoding can break direct <img src>).
 */
export function sanitizeImageUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  return trimmed;
}

/**
 * For use ONLY when passing URL as a query param (Next/Image, proxy, etc.).
 * encodeURIComponent ensures '+' is not treated as space in query strings.
 */
export function encodeImageUrlForQueryParam(url: string): string {
  return encodeURIComponent(url);
}
