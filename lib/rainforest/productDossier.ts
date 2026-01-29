import { getCachedEnrichment, setCachedEnrichment } from "./enrichmentCache";

export type ProductDossier = {
  asin: string;
  amazon_domain: string;
  fetched_at: string;
  source: "rainforest_product";
  product: {
    title?: string;
    description?: string | null;
    feature_bullets?: string[];
    attributes?: { name: string; value: string }[];
    specifications?: { name: string; value: string }[];
    weight?: string | null;
    dimensions?: string | null;
    rating?: number | null;
    ratings_total?: number | null;
    rating_breakdown?: any;
    variants?: any[];
    first_available_raw?: string | null;
    first_available_utc?: string | null;
  };
  review_material: {
    customers_say?: { name: string; value: "Positive" | "Mixed" | "Negative" | string }[];
    summarization_attributes?: { name: string; value: string }[];
    top_reviews?: {
      rating?: number;
      title?: string;
      body?: string;
      verified_purchase?: boolean;
    }[];
  };
};

const RAINFOREST_ENDPOINT = "product";
const PARAMS_HASH = "type=product:include_summarization_attributes=true:v1";

// In-flight dedupe across concurrent callers (per process)
const inflight = new Map<string, Promise<ProductDossier>>();

function buildCacheKey(asin: string, amazonDomain: string) {
  return `${asin}:${amazonDomain}:${RAINFOREST_ENDPOINT}:${PARAMS_HASH}`;
}

export async function getProductDossier(
  asin: string,
  amazonDomain: string = "amazon.com"
): Promise<ProductDossier> {
  const key = buildCacheKey(asin, amazonDomain);
  console.log("DOSSIER_CACHE_KEY", { asin, key });

  const existing = inflight.get(key);
  if (existing) {
    console.log("DOSSIER_INFLIGHT_DEDUPE_HIT", { asin });
    return existing;
  }

  const promise = (async () => {
    // 1) Global 7-day cache (DB) - shared across all users
    const cached = await getCachedEnrichment<ProductDossier>({
      asin,
      amazonDomain,
      endpoint: RAINFOREST_ENDPOINT,
      paramsHash: PARAMS_HASH,
    });
    if (cached && cached.payload) {
      console.log("DOSSIER_CACHE_HIT", { asin });
      return cached.payload;
    }

    console.log("DOSSIER_CACHE_MISS", { asin });
    console.log("DOSSIER_RAINFOREST_CALL", { asin, credits: 1 });

    const apiKey = process.env.RAINFOREST_API_KEY;
    if (!apiKey) {
      throw new Error("RAINFOREST_API_KEY not configured");
    }

    const params = new URLSearchParams({
      api_key: apiKey,
      type: "product",
      amazon_domain: amazonDomain,
      asin,
      include_summarization_attributes: "true",
      // Request core fields we rely on for specs + reviews + listing age
      fields:
        "product.title,product.description,product.feature_bullets,product.attributes,product.specifications,product.item_dimensions,product.item_weight,product.rating,product.rating_breakdown,product.reviews_total,product.total_reviews,product.customers_say,product.summarization_attributes,product.top_reviews,product.variants,product.first_available",
    });

    const url = `https://api.rainforestapi.com/request?${params.toString()}`;

    const startTime = Date.now();
    const resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const duration = Date.now() - startTime;

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "Unknown error");
      console.error("DOSSIER_RAINFOREST_ERROR", {
        asin,
        amazon_domain: amazonDomain,
        http_status: resp.status,
        error: errText.substring(0, 200),
        duration_ms: duration,
      });
      throw new Error(
        `Rainforest product dossier error: HTTP ${resp.status} ${errText.substring(
          0,
          120
        )}`
      );
    }

    const data = await resp.json().catch(() => null);
    const product = (data && data.product) || {};

    const title = (product.title as string | undefined) || undefined;
    const description =
      (product.description as string | undefined | null) ?? null;

    const rawBullets = product.feature_bullets;
    const feature_bullets: string[] | undefined = Array.isArray(rawBullets)
      ? rawBullets
          .map((b: any) =>
            typeof b === "string" ? b.trim() : (b?.text || "").trim()
          )
          .filter((b: string) => !!b)
      : undefined;

    const attributes: { name: string; value: string }[] | undefined =
      product.attributes && typeof product.attributes === "object"
        ? Object.entries(product.attributes)
            .map(([name, value]) => ({
              name,
              value:
                typeof value === "string"
                  ? value
                  : JSON.stringify(value ?? ""),
            }))
            .filter(
              (p) => p.name && typeof p.value === "string" && p.value.length > 0
            )
        : undefined;

    const specifications: { name: string; value: string }[] | undefined =
      product.specifications && typeof product.specifications === "object"
        ? Object.entries(product.specifications)
            .map(([name, value]) => ({
              name,
              value:
                typeof value === "string"
                  ? value
                  : JSON.stringify(value ?? ""),
            }))
            .filter(
              (p) => p.name && typeof p.value === "string" && p.value.length > 0
            )
        : undefined;

    const weight: string | null =
      (product.item_weight as string | undefined | null) ??
      (product.weight as string | undefined | null) ??
      null;

    const dimensions: string | null =
      (product.item_dimensions as string | undefined | null) ??
      (product.dimensions as string | undefined | null) ??
      null;

    const rating: number | null =
      typeof product.rating === "number" ? product.rating : null;

    const ratings_total_raw =
      product.reviews_total ??
      product.total_reviews ??
      product.total_review_count ??
      null;
    const ratings_total: number | null =
      typeof ratings_total_raw === "number" ? ratings_total_raw : null;

    const rating_breakdown = product.rating_breakdown ?? null;

    const variants = Array.isArray(product.variants)
      ? product.variants
      : product.variants
      ? [product.variants]
      : [];

    // DATE FIRST AVAILABLE (listing age)
    let first_available_raw: string | null = null;
    let first_available_utc: string | null = null;

    // Try product.first_available first
    const firstAvailableRaw = product.first_available;
    if (firstAvailableRaw) {
      if (typeof firstAvailableRaw === "object") {
        // Structure: { raw: "...", utc: "..." }
        first_available_raw =
          (firstAvailableRaw.raw as string | undefined | null) ?? null;
        const utcValue = firstAvailableRaw.utc;
        if (utcValue) {
          // Normalize to ISO8601 string if it's a date/timestamp
          if (typeof utcValue === "string") {
            first_available_utc = utcValue;
          } else if (utcValue instanceof Date) {
            first_available_utc = utcValue.toISOString();
          } else if (typeof utcValue === "number") {
            // Assume Unix timestamp (seconds or milliseconds)
            const date =
              utcValue > 1e10
                ? new Date(utcValue)
                : new Date(utcValue * 1000);
            first_available_utc = date.toISOString();
          }
        }
      } else if (typeof firstAvailableRaw === "string") {
        // Simple string value
        first_available_raw = firstAvailableRaw;
      }
    }

    // Fallback: parse from specifications if first_available wasn't found
    if (!first_available_raw && !first_available_utc && specifications) {
      const dateFirstAvailableSpec = specifications.find(
        (spec) =>
          spec.name &&
          spec.name.toLowerCase().includes("date first available")
      );
      if (dateFirstAvailableSpec && dateFirstAvailableSpec.value) {
        first_available_raw = dateFirstAvailableSpec.value;
        // Try to parse as ISO8601 or common date formats
        try {
          const parsed = new Date(dateFirstAvailableSpec.value);
          if (!isNaN(parsed.getTime())) {
            first_available_utc = parsed.toISOString();
          }
        } catch {
          // Keep raw only if parsing fails
        }
      }
    }

    // REVIEW MATERIAL
    const customersSayRaw = product.customers_say;
    let customers_say:
      | { name: string; value: "Positive" | "Mixed" | "Negative" | string }[]
      | undefined;

    if (customersSayRaw) {
      const items: {
        name: string;
        value: "Positive" | "Mixed" | "Negative" | string;
      }[] = [];

      const normalizeSentiment = (s: any) => {
        const v = String(s || "").toLowerCase();
        if (v.includes("positive")) return "Positive" as const;
        if (v.includes("negative")) return "Negative" as const;
        if (v.includes("mixed")) return "Mixed" as const;
        return s?.toString() || "Mixed";
      };

      if (Array.isArray(customersSayRaw)) {
        for (const item of customersSayRaw) {
          const name = (item.theme || item.label || "").toString().trim();
          const sentiment = normalizeSentiment(item.sentiment);
          if (!name) continue;
          items.push({ name, value: sentiment });
        }
      } else if (
        typeof customersSayRaw === "object" &&
        Array.isArray(customersSayRaw.themes)
      ) {
        for (const theme of customersSayRaw.themes) {
          const name = (theme.label || theme.theme || "").toString().trim();
          const sentiment = normalizeSentiment(theme.sentiment);
          if (!name) continue;
          items.push({ name, value: sentiment });
        }
      }

      if (items.length > 0) {
        customers_say = items;
      }
    }

    const summarization_attributes_raw = product.summarization_attributes;
    let summarization_attributes:
      | {
          name: string;
          value: string;
        }[]
      | undefined;

    if (
      summarization_attributes_raw &&
      typeof summarization_attributes_raw === "object"
    ) {
      const attrs: { name: string; value: string }[] = [];
      for (const [name, value] of Object.entries(
        summarization_attributes_raw
      )) {
        if (!name) continue;
        if (value && typeof value === "object" && "rating" in value) {
          const ratingVal = (value as any).rating;
          attrs.push({
            name,
            value:
              typeof ratingVal === "number"
                ? ratingVal.toString()
                : JSON.stringify(value),
          });
        } else {
          attrs.push({
            name,
            value:
              typeof value === "string" ? value : JSON.stringify(value ?? ""),
          });
        }
      }
      if (attrs.length > 0) {
        summarization_attributes = attrs;
      }
    }

    const rawTopReviews = product.top_reviews || product.representative_reviews;
    const top_reviews: {
      rating?: number;
      title?: string;
      body?: string;
      verified_purchase?: boolean;
    }[] | undefined = Array.isArray(rawTopReviews)
      ? rawTopReviews
          .map((r: any) => ({
            rating: typeof r.rating === "number" ? r.rating : undefined,
            title:
              (r.title ||
                r.review_title ||
                (typeof r.headline === "string" ? r.headline : null)) ??
              undefined,
            body:
              (r.text ||
                r.body ||
                r.review_text ||
                (typeof r.snippet === "string" ? r.snippet : "") ||
                "") || undefined,
            verified_purchase:
              r.verified_purchase === true
                ? true
                : r.verified_purchase === false
                ? false
                : undefined,
          }))
          .filter((r) => !!(r.body && r.body.trim().length > 0))
      : undefined;

    const dossier: ProductDossier = {
      asin,
      amazon_domain: amazonDomain,
      fetched_at: new Date().toISOString(),
      source: "rainforest_product",
      product: {
        title,
        description,
        feature_bullets,
        attributes,
        specifications,
        weight,
        dimensions,
        rating,
        ratings_total,
        rating_breakdown,
        variants,
        ...(first_available_raw !== null
          ? { first_available_raw }
          : {}),
        ...(first_available_utc !== null ? { first_available_utc } : {}),
      },
      review_material: {
        ...(customers_say ? { customers_say } : {}),
        ...(summarization_attributes
          ? { summarization_attributes }
          : {}),
        ...(top_reviews ? { top_reviews } : {}),
      },
    };

    console.log("DOSSIER_BUILT", {
      asin,
      has_customers_say: !!customers_say && customers_say.length > 0,
      top_reviews_count: top_reviews ? top_reviews.length : 0,
      has_specs: !!specifications && specifications.length > 0,
      has_weight: !!weight,
      has_dimensions: !!dimensions,
      has_first_available_raw: !!first_available_raw,
      has_first_available_utc: !!first_available_utc,
    });

    // Persist to global cache (best-effort)
    await setCachedEnrichment(
      {
        asin,
        amazonDomain,
        endpoint: RAINFOREST_ENDPOINT,
        paramsHash: PARAMS_HASH,
      },
      { payload: dossier },
      { creditsEstimated: 1 }
    );

    return dossier;
  })();

  inflight.set(key, promise);

  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

