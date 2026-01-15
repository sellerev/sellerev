# SP-API Verification Plan

## 1. LOCKED SP_API_ENDPOINT_MAP

### Endpoint Configuration (Immutable)

```typescript
const SP_API_ENDPOINT_MAP = {
  // ═══════════════════════════════════════════════════════════════════════════
  // CATALOG ITEMS API v2022-04-01
  // ═══════════════════════════════════════════════════════════════════════════
  catalogItems: {
    endpoint: "/catalog/2022-04-01/items",
    method: "GET",
    version: "2022-04-01",
    batchSize: 20, // Max ASINs per request
    maxParallelBatches: 3, // For 49 ASINs: 3 batches (20+20+9)
    timeoutMs: 2000,
    requiredParams: {
      marketplaceIds: "string", // e.g., "ATVPDKIKX0DER" (US)
      includedData: "string", // "summaries,attributes,salesRanks"
    },
    pathParams: {}, // No path params - uses batch endpoint
    queryParams: {
      marketplaceIds: "string", // Required: e.g., "ATVPDKIKX0DER"
      identifiersType: "string", // Required: "ASIN"
      identifiers: "string", // Required: comma-separated ASINs (max 20)
      includedData: "string", // Required: "attributes,identifiers,images,summaries,salesRanks"
    },
    responseFields: {
      // summaries → title, brand, images
      summaries: {
        marketplaceId: "string",
        brandName: "string | null", // → brand
        browseClassification: {
          displayName: "string | null", // → category
        },
        itemName: "string | null", // → title
        images: [{
          variant: "MAIN",
          link: "string", // → image_url
        }],
      },
      // attributes → dimensions (for fees)
      attributes: {
        item_package_dimensions: {
          length: { unit: "string", value: number },
          width: { unit: "string", value: number },
          height: { unit: "string", value: number },
        },
        item_package_weight: {
          unit: "string",
          value: number,
        },
      },
      // salesRanks → BSR
      salesRanks: [{
        marketplaceId: "string",
        ranks: [{
          title: "string", // Category name
          rank: number, // → bsr
          link: "string",
        }],
      }],
    },
    extractedFields: {
      title: "summaries[0].itemName",
      brand: "summaries[0].brandName",
      image_url: "summaries[0].images.find(i => i.variant === 'MAIN')?.link",
      category: "summaries[0].browseClassification.displayName",
      bsr: "salesRanks[0].ranks[0].rank", // First rank (main category)
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PRICING API v0 (GetItemOffers)
  // ═══════════════════════════════════════════════════════════════════════════
  pricing: {
    endpoint: "/pricing/v0/items/{asin}/offers",
    method: "GET",
    version: "v0",
    batchSize: 5, // Conservative for Pricing API
    maxParallelBatches: 10, // For 49 ASINs: 10 batches (5 each)
    timeoutMs: 2000,
    requiredParams: {
      MarketplaceId: "string", // e.g., "ATVPDKIKX0DER" (US)
      ItemCondition: "string", // "New"
      CustomerType: "string", // "Consumer"
    },
    pathParams: {
      asin: "string", // Single ASIN in path: /pricing/v0/items/{asin}/offers
    },
    queryParams: {
      MarketplaceId: "string", // Required
      ItemCondition: "string", // Required: "New"
      CustomerType: "string", // Required: "Consumer"
    },
    responseFields: {
      Summary: {
        TotalOfferCount: number, // → offer_count
        BuyBoxPrices: [{
          sellerId: "string", // "ATVPDKIKX0DER" = Amazon, else Merchant
          FulfillmentChannel: "string", // "Amazon" = FBA, "Merchant" = FBM
          LandedPrice: {
            Amount: string, // → buy_box_price (parseFloat)
            CurrencyCode: "string",
          },
        }],
        LowestPrices: [{
          FulfillmentChannel: "string",
          LandedPrice: {
            Amount: string, // → lowest_price (parseFloat)
            CurrencyCode: "string",
          },
        }],
      },
      Offers: "array", // Full offer list (not used, Summary is sufficient)
    },
    extractedFields: {
      buy_box_owner: "Summary.BuyBoxPrices[0].sellerId === 'ATVPDKIKX0DER' ? 'Amazon' : 'Merchant'",
      offer_count: "Summary.TotalOfferCount",
      fulfillment_channel: "Summary.BuyBoxPrices[0].FulfillmentChannel === 'Amazon' ? 'FBA' : 'FBM'",
      buy_box_price: "parseFloat(Summary.BuyBoxPrices[0].LandedPrice.Amount)",
      lowest_price: "parseFloat(Summary.LowestPrices[0].LandedPrice.Amount)",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FEES API v0 (GetMyFeesEstimateForASIN)
  // ═══════════════════════════════════════════════════════════════════════════
  fees: {
    endpoint: "/products/fees/v0/items/{asin}/feesEstimate",
    method: "POST",
    version: "v0",
    batchSize: 1, // One ASIN per request (no batch endpoint)
    maxParallelRequests: 10, // Parallel requests for multiple ASINs
    timeoutMs: 3000,
    requiredParams: {
      FeesEstimateRequest: {
        MarketplaceId: "string", // e.g., "ATVPDKIKX0DER" (US)
        IdType: "string", // "ASIN"
        IdValue: "string", // ASIN
        PriceToEstimateFees: {
          ListingPrice: {
            Amount: number, // Price in USD
            CurrencyCode: "string", // "USD"
          },
        },
        Identifier: "string", // Request ID (UUID)
        IsAmazonFulfilled: true, // Always true for FBA fees
      },
    },
    pathParams: {
      asin: "string", // Single ASIN in path: /products/fees/v0/items/{asin}/feesEstimate
    },
    bodyParams: {
      FeesEstimateRequest: {
        MarketplaceId: "string", // Required
        IdType: "string", // Required: "ASIN"
        IdValue: "string", // Required: ASIN
        PriceToEstimateFees: {
          ListingPrice: {
            Amount: number, // Required: price
            CurrencyCode: "string", // Required: "USD"
          },
        },
        Identifier: "string", // Required: UUID
        IsAmazonFulfilled: true, // Required: true
        ProductDimensions: "object | null", // Optional: retry with dimensions if first attempt fails
      },
    },
    responseFields: {
      FeesEstimateResult: {
        FeesEstimate: {
          TotalFeesEstimate: {
            Amount: string, // → total_fba_fees (parseFloat)
            CurrencyCode: "string",
          },
          FeeDetailList: [{
            FeeType: "string", // "FBAFulfillmentFee" or "ReferralFee"
            FeeAmount: {
              Amount: string,
              CurrencyCode: "string",
            },
          }],
        },
        Status: "string", // "Success" or error code
        Errors: [{
          Code: "string",
          Message: "string",
          Details: "string",
        }],
      },
    },
    extractedFields: {
      fulfillment_fee: "FeeDetailList.find(f => f.FeeType === 'FBAFulfillmentFee')?.FeeAmount.Amount (parseFloat)",
      referral_fee: "FeeDetailList.find(f => f.FeeType === 'ReferralFee')?.FeeAmount.Amount (parseFloat)",
      total_fba_fees: "TotalFeesEstimate.Amount (parseFloat)",
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// MARKETPLACE ENDPOINT MAPPING
// ═══════════════════════════════════════════════════════════════════════════
const MARKETPLACE_ENDPOINT_MAP = {
  ATVPDKIKX0DER: { // US
    baseUrl: "https://sellingpartnerapi-na.amazon.com",
    region: "us-east-1",
  },
  A1PA6795UKMFR9: { // DE
    baseUrl: "https://sellingpartnerapi-eu.amazon.com",
    region: "eu-west-1",
  },
  A1RKKUPIHCS9HS: { // ES
    baseUrl: "https://sellingpartnerapi-eu.amazon.com",
    region: "eu-west-1",
  },
  A13V1IB3VIYZZH: { // FR
    baseUrl: "https://sellingpartnerapi-eu.amazon.com",
    region: "eu-west-1",
  },
  APJ6JRA9NG5V4: { // IT
    baseUrl: "https://sellingpartnerapi-eu.amazon.com",
    region: "eu-west-1",
  },
  A1F83G8C2ARO7P: { // UK
    baseUrl: "https://sellingpartnerapi-eu.amazon.com",
    region: "eu-west-1",
  },
  A1VC38T7YXB528: { // JP
    baseUrl: "https://sellingpartnerapi-fe.amazon.com",
    region: "us-west-2",
  },
  A19VAU5U5O7RUS: { // CA
    baseUrl: "https://sellingpartnerapi-na.amazon.com",
    region: "us-east-1",
  },
};
```

## 2. FIELD SOURCING MATRIX

### Per-Field Source Attribution

| Field | Primary Source | Fallback Source | Source Tag | Notes |
|-------|---------------|-----------------|------------|-------|
| **asin** | Rainforest SERP | N/A | `rainforest_serp` | Always from Rainforest search |
| **page_position** | Rainforest SERP | N/A | `rainforest_serp` | Rank from search results |
| **is_sponsored** | Rainforest SERP | N/A | `rainforest_serp` | Sponsored flag from SERP |
| **price** | SP-API Pricing (buy_box_price) | Rainforest SERP | `sp_api_pricing` → `rainforest_serp` | Prefer authoritative buy box price |
| **title** | SP-API Catalog Items | Rainforest SERP | `sp_api_catalog` → `rainforest_serp` | SP-API is authoritative |
| **brand** | SP-API Catalog Items | Internal Model (inferred) | `sp_api_catalog` → `model_inferred` | Never from Rainforest (no brand in SERP) |
| **image_url** | SP-API Catalog Items | Rainforest SERP | `sp_api_catalog` → `rainforest_serp` | SP-API preferred, Rainforest acceptable |
| **rating** | Rainforest SERP | N/A | `rainforest_serp` | Not available in SP-API |
| **review_count** | Rainforest SERP | N/A | `rainforest_serp` | Not available in SP-API |
| **category** | SP-API Catalog Items | N/A | `sp_api_catalog` | Only from SP-API (no fallback) |
| **bsr** | SP-API Catalog Items (salesRanks) | N/A | `sp_api_catalog` | Only from SP-API (no fallback) |
| **buy_box_owner** | SP-API Pricing | N/A | `sp_api_pricing` | Only from SP-API (no fallback) |
| **offer_count** | SP-API Pricing | N/A | `sp_api_pricing` | Only from SP-API (no fallback) |
| **fulfillment** | SP-API Pricing (FulfillmentChannel) | Rainforest SERP (hint) | `sp_api_pricing` → `rainforest_serp` | SP-API authoritative, Rainforest hint acceptable |
| **estimated_monthly_units** | Internal Model | N/A | `model_estimated` | Always from internal estimation |
| **estimated_monthly_revenue** | Internal Model | N/A | `model_estimated` | Always from internal estimation |
| **fulfillment_fee** | SP-API Fees | N/A | `sp_api_fees` | Only from SP-API (no fallback) |
| **referral_fee** | SP-API Fees | N/A | `sp_api_fees` | Only from SP-API (no fallback) |

### Source Priority Rules

1. **SP-API is authoritative** for: brand, category, BSR, buy_box_owner, offer_count, fulfillment (when available)
2. **Rainforest is authoritative** for: asin, page_position, is_sponsored, rating, review_count
3. **Internal Model is authoritative** for: estimated_monthly_units, estimated_monthly_revenue
4. **Hybrid fields** (with fallback): price, title, image_url, fulfillment

## 3. MANDATORY SP-API LOGGING

### Log Format Specification

```typescript
interface SpApiLogEntry {
  // Request identification
  event_type: "SP_API_REQUEST" | "SP_API_RESPONSE" | "SP_API_ERROR";
  endpoint_name: "catalogItems" | "pricing" | "fees";
  api_version: string; // e.g., "2022-04-01", "v0"
  
  // Request details
  method: "GET" | "POST";
  path: string; // Full path including ASIN
  query_params?: Record<string, string>;
  marketplace_id: string;
  asin_count?: number; // For batch requests
  
  // Response details
  http_status: number;
  request_id: string | null; // x-amzn-RequestId header
  rate_limit_limit: string | null; // x-amzn-RateLimit-Limit header
  rate_limit_remaining: string | null; // x-amzn-RateLimit-Remaining header (if available)
  
  // Timing
  duration_ms: number;
  timestamp: string; // ISO 8601
  
  // Error details (if applicable)
  error_code?: string;
  error_message?: string;
  error_details?: any;
  
  // Success metrics
  enriched_count?: number; // Number of ASINs successfully enriched
  failed_count?: number; // Number of ASINs that failed
}

// Example log entries
console.log("SP_API_REQUEST", {
  event_type: "SP_API_REQUEST",
  endpoint_name: "catalogItems",
  api_version: "2022-04-01",
  method: "GET",
  path: "/catalog/2022-04-01/items/B08XYZ1234",
  query_params: {
    marketplaceIds: "ATVPDKIKX0DER",
    includedData: "summaries,attributes,salesRanks",
  },
  marketplace_id: "ATVPDKIKX0DER",
  asin_count: 20,
  timestamp: new Date().toISOString(),
});

console.log("SP_API_RESPONSE", {
  event_type: "SP_API_RESPONSE",
  endpoint_name: "catalogItems",
  api_version: "2022-04-01",
  http_status: 200,
  request_id: "abc123-def456-ghi789",
  rate_limit_limit: "0.5",
  rate_limit_remaining: "0.4",
  duration_ms: 450,
  enriched_count: 18,
  failed_count: 2,
  timestamp: new Date().toISOString(),
});

console.log("SP_API_ERROR", {
  event_type: "SP_API_ERROR",
  endpoint_name: "pricing",
  api_version: "v0",
  http_status: 429,
  request_id: "xyz789-abc123-def456",
  rate_limit_limit: "0.5",
  rate_limit_remaining: "0",
  error_code: "QuotaExceeded",
  error_message: "Rate limit exceeded",
  duration_ms: 120,
  timestamp: new Date().toISOString(),
});
```

### Logging Implementation Requirements

1. **Log every SP-API request** (before fetch)
2. **Log every SP-API response** (after fetch, extract headers)
3. **Log every SP-API error** (with full error context)
4. **Extract headers from response**:
   ```typescript
   const requestId = response.headers.get("x-amzn-RequestId");
   const rateLimitLimit = response.headers.get("x-amzn-RateLimit-Limit");
   const rateLimitRemaining = response.headers.get("x-amzn-RateLimit-Remaining");
   ```
5. **Aggregate batch results** in summary log:
   ```typescript
   console.log("SP_API_BATCH_COMPLETE", {
     endpoint_name: "catalogItems",
     total_asins: 49,
     total_batches: 3,
     enriched_count: 45,
     failed_count: 4,
     total_duration_ms: 1250,
     avg_duration_ms: 417,
   });
   ```

## 4. PER-FIELD SOURCE TAGGING

### Database Schema Extension

```sql
-- Add source tagging columns to keyword_products
ALTER TABLE public.keyword_products
  ADD COLUMN IF NOT EXISTS title_source TEXT CHECK (title_source IN ('sp_api_catalog', 'rainforest_serp', 'model_inferred')),
  ADD COLUMN IF NOT EXISTS brand_source TEXT CHECK (brand_source IN ('sp_api_catalog', 'model_inferred')),
  ADD COLUMN IF NOT EXISTS image_source TEXT CHECK (image_source IN ('sp_api_catalog', 'rainforest_serp')),
  ADD COLUMN IF NOT EXISTS price_source TEXT CHECK (price_source IN ('sp_api_pricing', 'rainforest_serp')),
  ADD COLUMN IF NOT EXISTS category_source TEXT CHECK (category_source IN ('sp_api_catalog')),
  ADD COLUMN IF NOT EXISTS bsr_source TEXT CHECK (bsr_source IN ('sp_api_catalog')),
  ADD COLUMN IF NOT EXISTS buy_box_owner_source TEXT CHECK (buy_box_owner_source IN ('sp_api_pricing')),
  ADD COLUMN IF NOT EXISTS offer_count_source TEXT CHECK (offer_count_source IN ('sp_api_pricing')),
  ADD COLUMN IF NOT EXISTS fulfillment_source TEXT CHECK (fulfillment_source IN ('sp_api_pricing', 'rainforest_serp'));
```

### Source Tagging Logic

```typescript
// In keywordProcessor.ts merge logic
const keywordProduct = {
  // ... other fields ...
  
  // Source tagging (mandatory for all fields)
  title_source: catalogEnriched?.title ? 'sp_api_catalog' : (rf?.title_hint ? 'rainforest_serp' : null),
  brand_source: catalogEnriched?.brand ? 'sp_api_catalog' : (canonical.brand ? 'model_inferred' : null),
  image_source: catalogEnriched?.image_url ? 'sp_api_catalog' : (rf?.image_hint ? 'rainforest_serp' : null),
  price_source: pricingEnriched?.buy_box_price ? 'sp_api_pricing' : (rf?.price ? 'rainforest_serp' : null),
  category_source: catalogEnriched?.category ? 'sp_api_catalog' : null,
  bsr_source: catalogEnriched?.bsr ? 'sp_api_catalog' : null,
  buy_box_owner_source: pricingEnriched?.buy_box_owner ? 'sp_api_pricing' : null,
  offer_count_source: pricingEnriched?.offer_count ? 'sp_api_pricing' : null,
  fulfillment_source: pricingEnriched?.fulfillment_channel ? 'sp_api_pricing' : (rf?.fulfillment_hint ? 'rainforest_serp' : null),
};
```

## 5. KILL-SWITCH TEST SCENARIO

### Test: Disable Rainforest Enrichment, Verify SP-API-Only Fields

**Objective**: Prove that brand, BSR, buy_box_owner, and offer_count are sourced exclusively from SP-API, not Rainforest.

**Test Setup**:
1. Set environment variable: `DISABLE_RAINFOREST_ENRICHMENT=true`
2. Modify `keywordProcessor.ts` to skip Rainforest title/brand/image hints when flag is set
3. Run keyword analysis for a test keyword (e.g., "wireless earbuds")

**Expected Behavior**:
- Rainforest search still runs (for ASIN discovery)
- Rainforest title/brand/image hints are **ignored** (not used as fallback)
- SP-API Catalog Items provides: brand, category, BSR
- SP-API Pricing provides: buy_box_owner, offer_count, fulfillment
- Product cards render with:
  - ✅ **brand**: From SP-API Catalog Items (or null if SP-API fails)
  - ✅ **bsr**: From SP-API Catalog Items (or null if SP-API fails)
  - ✅ **buy_box_owner**: From SP-API Pricing (or null if SP-API fails)
  - ✅ **offer_count**: From SP-API Pricing (or null if SP-API fails)
  - ❌ **title**: May be null if SP-API fails (Rainforest hint disabled)
  - ❌ **image_url**: May be null if SP-API fails (Rainforest hint disabled)

**Kill-Switch Implementation**:
```typescript
// In keywordProcessor.ts
const DISABLE_RAINFOREST_ENRICHMENT = process.env.DISABLE_RAINFOREST_ENRICHMENT === 'true';

// In merge logic
const finalTitle = catalogEnriched?.title || 
  (DISABLE_RAINFOREST_ENRICHMENT ? null : (cached?.title || rf?.title_hint || canonical.title));

const finalBrand = catalogEnriched?.brand || 
  (DISABLE_RAINFOREST_ENRICHMENT ? null : (cached?.brand || canonical.brand));

const finalImageUrl = catalogEnriched?.image_url || 
  (DISABLE_RAINFOREST_ENRICHMENT ? null : (cached?.image_url || rf?.image_hint || canonical.image_url));
```

**Verification Steps**:
1. Enable kill-switch: `DISABLE_RAINFOREST_ENRICHMENT=true`
2. Run analysis for keyword with known ASINs
3. Check logs: Verify no Rainforest hints used for title/brand/image
4. Check database: Verify `brand_source`, `bsr_source`, `buy_box_owner_source`, `offer_count_source` are all `'sp_api_catalog'` or `'sp_api_pricing'`
5. Check UI: Product cards show brand, BSR, buy_box_owner, offer_count (even if title/image are null)

**Success Criteria**:
- ✅ All SP-API-only fields (brand, BSR, buy_box_owner, offer_count) are populated from SP-API
- ✅ No Rainforest fallback used for these fields
- ✅ Source tags confirm SP-API origin
- ✅ Product cards render correctly (may have null title/image, but SP-API fields present)

## 6. EXTERNAL VERIFICATION IN SELLER CENTRAL

### SP-API Usage Dashboard Location

1. **Navigate to**: Seller Central → Apps & Services → Developer Central → SP-API Usage Dashboard
2. **View Metrics**:
   - Total API calls by endpoint
   - Rate limit usage
   - Error rates
   - Call volume over time

### Expected SP-API Usage Pattern

**For a single keyword analysis (49 ASINs)**:

| Endpoint | Expected Calls | Notes |
|----------|----------------|-------|
| **Catalog Items** | 3 calls | 49 ASINs ÷ 20 per batch = 3 batches (20+20+9) |
| **Pricing (GetItemOffers)** | 10 calls | 49 ASINs ÷ 5 per batch = 10 batches (5 each) |
| **Fees (GetMyFeesEstimate)** | 0-49 calls | Only called for margin analysis (not in main pipeline) |

**Total**: ~13-62 SP-API calls per keyword analysis

### Verification Checklist

1. **Catalog Items API**:
   - ✅ Verify calls to `/catalog/2022-04-01/items` (batch endpoint)
   - ✅ Verify `identifiersType=ASIN` and `identifiers={comma-separated-ASINs}` parameters
   - ✅ Verify `includedData=attributes,identifiers,images,summaries,salesRanks` parameter
   - ✅ Verify batch size ≤ 20 ASINs per request
   - ✅ Verify rate limit headers logged

2. **Pricing API**:
   - ✅ Verify calls to `/pricing/v0/items/{asin}/offers`
   - ✅ Verify `ItemCondition=New` and `CustomerType=Consumer` parameters
   - ✅ Verify batch size ≤ 5 ASINs per request
   - ✅ Verify rate limit headers logged

3. **Fees API** (if used):
   - ✅ Verify calls to `/products/fees/v0/items/{asin}/feesEstimate`
   - ✅ Verify POST method with FeesEstimateRequest body
   - ✅ Verify rate limit headers logged

### Log Correlation

**Match application logs to Seller Central dashboard**:
1. Extract `x-amzn-RequestId` from application logs
2. Search Seller Central API logs for matching RequestId
3. Verify:
   - Endpoint matches
   - Timestamp matches (within 1-2 seconds)
   - Response status matches
   - Rate limit usage matches

### Rate Limit Monitoring

**Expected rate limits** (from SP-API documentation):
- Catalog Items: ~0.5 requests/second
- Pricing: ~0.5 requests/second
- Fees: ~0.5 requests/second

**Monitoring**:
- Log `x-amzn-RateLimit-Limit` header (expected: "0.5")
- Log `x-amzn-RateLimit-Remaining` header (if available)
- Alert if rate limit remaining < 0.1
- Alert if 429 (Too Many Requests) errors occur

## 7. IMPLEMENTATION CHECKLIST

Before code implementation, verify:

- [ ] **SP_API_ENDPOINT_MAP** is locked and matches actual SP-API documentation
- [ ] **Field sourcing matrix** is complete and accurate
- [ ] **Logging format** includes all required fields (endpoint_name, request_id, rate_limit_limit)
- [ ] **Source tagging** is implemented for all fields in database
- [ ] **Kill-switch test** can be executed and verified
- [ ] **Seller Central verification** process is documented and testable

## 8. ACCEPTANCE CRITERIA

✅ **SP-API endpoints are correctly called**:
- Catalog Items: `/catalog/2022-04-01/items/{asin}` with correct parameters
- Pricing: `/pricing/v0/items/{asin}/offers` with correct parameters
- Fees: `/fees/v0/items/{asin}/feesEstimate` with correct body

✅ **Fields are correctly sourced**:
- Brand, BSR, buy_box_owner, offer_count are SP-API-only (no Rainforest fallback)
- Source tags are stored in database for all fields

✅ **Logging is comprehensive**:
- Every request logs endpoint_name, request_id, rate_limit_limit
- Response logs include http_status, duration_ms, enriched_count

✅ **Kill-switch test passes**:
- With Rainforest enrichment disabled, SP-API-only fields still populate
- Source tags confirm SP-API origin

✅ **External verification works**:
- SP-API calls visible in Seller Central dashboard
- RequestIds match between application logs and Seller Central

---

**Status**: ⏳ **AWAITING APPROVAL**

This verification plan must be approved before implementation code is written.

