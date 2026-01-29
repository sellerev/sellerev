import { createClient } from "@supabase/supabase-js";

type Endpoint = "product" | "reviews" | string;

interface CacheKey {
  asin: string;
  amazonDomain: string;
  endpoint: Endpoint;
  paramsHash: string;
}

interface CachePayload<TPayload = any, TExtracted = any> {
  payload: TPayload;
  extracted?: TExtracted | null;
}

const TTL_DAYS = 7;

let supabaseSingleton:
  | ReturnType<typeof createClient<any, "public", any>>
  | null = null;

function getSupabaseServiceClient() {
  if (supabaseSingleton) return supabaseSingleton;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.warn(
      "RAINFOREST_ENRICHMENT_CACHE_DISABLED: Supabase URL or service role key not configured."
    );
    return null;
  }

  supabaseSingleton = createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseSingleton;
}

export async function getCachedEnrichment<TPayload = any, TExtracted = any>(
  key: CacheKey
): Promise<CachePayload<TPayload, TExtracted> | null> {
  const client = getSupabaseServiceClient();
  if (!client) return null;

  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await client
      .from("asin_enrichment_cache")
      .select("payload, extracted")
      .eq("asin", key.asin)
      .eq("amazon_domain", key.amazonDomain)
      .eq("endpoint", key.endpoint)
      .eq("params_hash", key.paramsHash)
      .gt("expires_at", nowIso)
      .maybeSingle();

    if (error) {
      console.error("RAINFOREST_CACHE_LOOKUP_ERROR", {
        asin: key.asin,
        endpoint: key.endpoint,
        params_hash: key.paramsHash,
        error,
      });
      return null;
    }

    if (!data) {
      console.log("RAINFOREST_CACHE_MISS", {
        asin: key.asin,
        endpoint: key.endpoint,
        params_hash: key.paramsHash,
      });
      return null;
    }

    // Best-effort last_accessed_at update (non-blocking for callers)
    client
      .from("asin_enrichment_cache")
      .update({ last_accessed_at: nowIso })
      .eq("asin", key.asin)
      .eq("amazon_domain", key.amazonDomain)
      .eq("endpoint", key.endpoint)
      .eq("params_hash", key.paramsHash);

    console.log("RAINFOREST_CACHE_HIT", {
      asin: key.asin,
      endpoint: key.endpoint,
      params_hash: key.paramsHash,
    });
    console.log("RAINFOREST_CALL_SKIPPED_DUE_TO_CACHE", {
      asin: key.asin,
      endpoint: key.endpoint,
    });

    return {
      payload: data.payload as TPayload,
      extracted: (data.extracted as TExtracted | null) ?? null,
    };
  } catch (error) {
    console.error("RAINFOREST_CACHE_LOOKUP_EXCEPTION", {
      asin: key.asin,
      endpoint: key.endpoint,
      params_hash: key.paramsHash,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function setCachedEnrichment<TPayload = any, TExtracted = any>(
  key: CacheKey,
  data: CachePayload<TPayload, TExtracted>,
  opts?: { creditsEstimated?: number }
): Promise<void> {
  const client = getSupabaseServiceClient();
  if (!client) return;

  try {
    const now = new Date();
    const expires = new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000);

    // Extract first_available fields from ProductDossier payload if present
    // (for optional queryable columns - payload JSONB remains source of truth)
    let firstAvailableRaw: string | null = null;
    let firstAvailableUtc: string | null = null;
    if (
      data.payload &&
      typeof data.payload === "object" &&
      "product" in data.payload
    ) {
      const product = (data.payload as any).product;
      if (product && typeof product === "object") {
        firstAvailableRaw = product.first_available_raw ?? null;
        firstAvailableUtc = product.first_available_utc ?? null;
      }
    }

    const { error } = await client
      .from("asin_enrichment_cache")
      .upsert(
        {
          asin: key.asin,
          amazon_domain: key.amazonDomain,
          endpoint: key.endpoint,
          params_hash: key.paramsHash,
          payload: data.payload,
          extracted: data.extracted ?? null,
          fetched_at: now.toISOString(),
          expires_at: expires.toISOString(),
          last_accessed_at: now.toISOString(),
          credits_estimated:
            typeof opts?.creditsEstimated === "number"
              ? opts.creditsEstimated
              : 1,
          // Optional queryable columns (populated from payload when available)
          first_available_raw: firstAvailableRaw,
          first_available_utc: firstAvailableUtc,
        },
        {
          onConflict: "asin,amazon_domain,endpoint,params_hash",
        }
      );

    if (error) {
      console.error("RAINFOREST_CACHE_STORE_ERROR", {
        asin: key.asin,
        endpoint: key.endpoint,
        params_hash: key.paramsHash,
        error,
      });
    }
  } catch (error) {
    console.error("RAINFOREST_CACHE_STORE_EXCEPTION", {
      asin: key.asin,
      endpoint: key.endpoint,
      params_hash: key.paramsHash,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

