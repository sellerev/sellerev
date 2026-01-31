/**
 * Sanitize and encode image URLs for safe use in UI and query params.
 * Amazon image URLs sometimes contain '+' in filenames; when passed as query params
 * (e.g. Next/Image optimizer, proxy), '+' can be decoded as space and break the fetch.
 */

/** ASIN-as-image-id pattern: /I/B0XXXXXXXXX.jpg returns 400 from Amazon; reject these. */
const ASIN_IMAGE_PATTERN = /\/I\/[A-Z0-9]{10}\.(?:jpg|jpeg|png|webp)(?:\?|$)/i;

/**
 * Returns true if URL is the invalid "ASIN used as image id" fallback (Amazon returns 400).
 */
export function isInvalidAmazonAsinImageUrl(url: string): boolean {
  try {
    return ASIN_IMAGE_PATTERN.test(url) && /media-amazon\.com/i.test(url);
  } catch {
    return false;
  }
}

/**
 * Returns a safe string URL or null. Use for <img src> and display.
 * Does not encode the URL (encoding can break direct <img src>).
 * Rejects known-bad ASIN-as-image-id URLs that Amazon returns 400 for.
 */
export function sanitizeImageUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (isInvalidAmazonAsinImageUrl(trimmed)) return null;
  return trimmed;
}

/**
 * For use ONLY when passing URL as a query param (Next/Image, proxy, etc.).
 * encodeURIComponent ensures '+' is not treated as space in query strings.
 */
export function encodeImageUrlForQueryParam(url: string): string {
  return encodeURIComponent(url);
}
