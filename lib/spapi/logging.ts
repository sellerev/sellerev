/**
 * Shared SP-API logging helper
 * Provides consistent request/response/error logging with all required metadata
 */

export interface SpApiLogParams {
  event_type: 'SP_API_REQUEST' | 'SP_API_RESPONSE' | 'SP_API_ERROR';
  endpoint_name: 'catalogItems' | 'pricing' | 'fees';
  api_version?: string;
  method: string;
  path: string;
  query_params?: string;
  marketplace_id: string;
  asin_count?: number;
  http_status?: number;
  duration_ms?: number;
  request_id?: string | null;
  rate_limit_limit?: string | null;
  rate_limit_remaining?: string | null;
  error?: string;
  asins?: string[];
  batch_index?: number;
  total_batches?: number;
}

/**
 * Log SP-API request/response/error with all required metadata
 */
export function logSpApiEvent(params: SpApiLogParams): void {
  const {
    event_type,
    endpoint_name,
    api_version,
    method,
    path,
    query_params,
    marketplace_id,
    asin_count,
    http_status,
    duration_ms,
    request_id,
    rate_limit_limit,
    rate_limit_remaining,
    error,
    asins,
    batch_index,
    total_batches,
  } = params;

  const logData: Record<string, any> = {
    event_type,
    endpoint_name,
    api_version: api_version || (endpoint_name === 'catalogItems' ? '2022-04-01' : 'v0'),
    method,
    path,
    marketplace_id,
    timestamp: new Date().toISOString(),
  };

  if (query_params) logData.query_params = query_params;
  if (asin_count !== undefined) logData.asin_count = asin_count;
  if (asins) logData.asins = asins;
  if (batch_index !== undefined) logData.batch_index = batch_index;
  if (total_batches !== undefined) logData.total_batches = total_batches;

  if (event_type === 'SP_API_RESPONSE' || event_type === 'SP_API_ERROR') {
    if (http_status !== undefined) logData.http_status = http_status;
    if (duration_ms !== undefined) logData.duration_ms = duration_ms;
    if (request_id) logData.request_id = request_id;
    if (rate_limit_limit) logData.rate_limit_limit = rate_limit_limit;
    if (rate_limit_remaining) logData.rate_limit_remaining = rate_limit_remaining;
    if (error) logData.error = error;
  }

  // Use appropriate log level
  if (event_type === 'SP_API_ERROR') {
    console.error('SP_API_EVENT', logData);
  } else if (event_type === 'SP_API_RESPONSE' && http_status && http_status >= 400) {
    console.warn('SP_API_EVENT', logData);
  } else {
    console.log('SP_API_EVENT', logData);
  }
}

/**
 * Extract SP-API response headers for logging
 */
export function extractSpApiHeaders(headers: Headers): {
  request_id: string | null;
  rate_limit_limit: string | null;
  rate_limit_remaining: string | null;
} {
  return {
    request_id: headers.get('x-amzn-RequestId') || headers.get('x-amzn-requestid') || null,
    rate_limit_limit: headers.get('x-amzn-RateLimit-Limit') || headers.get('x-amzn-ratelimit-limit') || null,
    rate_limit_remaining: headers.get('x-amzn-RateLimit-Remaining') || headers.get('x-amzn-ratelimit-remaining') || null,
  };
}

