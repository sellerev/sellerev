# Rainforest API Property Usage Analysis

This document tracks which Rainforest API properties we extract and use from `search_results[]` items, and which we ignore.

## ✅ Properties We USE

### Core Identifiers (REQUIRED)
- **`asin`** ✅ **USED** - Primary identifier, required for all listings
- **`position`** ✅ **USED** - Position on search results page (1-indexed)
- **`title`** ✅ **USED** - Product title (primary source, fallback to `product_title`)

### Pricing
- **`price`** ✅ **USED** - Main price object
  - `price.value` ✅ **USED** - Numeric price value (primary)
  - `price.raw` ✅ **USED** - Raw price string (fallback)
  - `prices[]` ❌ **NOT USED** - Array of all price variants (we only use main `price`)

### Ratings & Reviews (AUTHORITATIVE - SP-API doesn't provide these)
- **`rating`** ✅ **USED** - Overall rating (0-5 scale)
- **`ratings_total`** ✅ **USED** - Total number of ratings (primary source)
- **`reviews.count`** ✅ **USED** - Review count (fallback)
- **`reviews_total`** ✅ **USED** - Review total (fallback)

### Images
- **`image`** ✅ **USED** - Product image URL (primary)
- **`image_url`** ✅ **USED** - Image URL (fallback)
- **`main_image`** ✅ **USED** - Main image (fallback)
- **`images[]`** ✅ **USED** - Image array, first item used as fallback

### Sponsored Status (CANONICAL - Single Source of Truth)
- **`sponsored`** ✅ **USED** - Boolean flag (normalized to `isSponsored` at ingest)
  - This is the **ONLY** authoritative field for sponsored detection
  - We do NOT use `ad_position` from Rainforest (we extract it but it's not reliable)

### Brand Information
- **`brand`** ✅ **USED** - Product brand name (primary source)
- **`brand_name`** ✅ **USED** - Brand name (fallback)
- **`is_amazon_brand`** ✅ **USED** - Amazon brand flag (for brand resolution)
- **`is_exclusive_to_amazon`** ✅ **USED** - Exclusive to Amazon flag (for brand resolution)
- **`featured_from_our_brands`** ✅ **USED** - Featured from our brands flag (for brand resolution)

### Prime & Fulfillment Hints (CANONICAL - Normalized at Ingest)
- **`is_prime`** ✅ **USED** - Prime eligibility flag (PRIMARY signal for FBA inference)
  - If `is_prime === true` → fulfillment = "FBA" (canonical inference)
- **`delivery`** ✅ **USED** - Delivery object (secondary signal for FBA inference)
  - `delivery.tagline` ✅ **USED** - Delivery tagline (checked for "Prime", "Get it", "Amazon" patterns)
  - `delivery.text` ✅ **USED** - Delivery text (checked for "Prime", "Get it", "Amazon" patterns)
  - `delivery.message` ✅ **USED** - Delivery message (fallback)
  - `delivery.price` ❌ **NOT USED**

**Fulfillment Inference Logic (Canonical):**
1. If `item.is_prime === true` → fulfillment = "FBA" (PRIMARY signal)
2. Else if `delivery.tagline` OR `delivery.text` contains "Prime", "Get it", or "Amazon" → "FBA"
3. Else if delivery info exists → "FBM"
4. Else → "UNKNOWN"

**Note:** This is market-level inference for competitive analysis, not checkout accuracy. We do NOT use SP-API or Offers API for fulfillment in Analyze flow.

### BSR (Best Seller Rank)
- **`bestsellers_rank[]`** ✅ **USED** - Array of BSR entries
  - `bestsellers_rank[].rank` ✅ **USED** - BSR rank value (primary)
  - `bestsellers_rank[].category` ✅ **USED** - Category name (for main category BSR)
  - Note: We extract this but SP-API Catalog BSR is authoritative

### Search Metadata
- **`search_information.total_results`** ✅ **USED** - Total search results count

### Top-Level Arrays
- **`search_results[]`** ✅ **USED** - Main array containing all listings (sponsored + organic)
  - This is the **ONLY** array we read from (we do NOT use `organic_results[]` or `ads[]`)

---

## ❌ Properties We DO NOT USE

### Badges & Indicators (Mostly Ignored)
- **`kindle_unlimited`** ❌ **NOT USED** - Kindle Unlimited badge
- **`prime_video`** ❌ **NOT USED** - Prime Video product flag
- **`is_small_business`** ❌ **NOT USED** - Small Business badge
- **`is_amazon_fresh`** ❌ **NOT USED** - Amazon Fresh product flag
- **`is_whole_foods_market`** ❌ **NOT USED** - Whole Foods Market flag
- **`coupon`** ❌ **NOT USED** - Coupon object (badge_text, text)
- **`deal`** ❌ **NOT USED** - Deal object (link, text, badge_text)
- **`climate_pledge_friendly`** ❌ **NOT USED** - Climate Pledge Friendly object
- **`gift_guide`** ❌ **NOT USED** - Gift Guide object
- **`amazons_choice`** ❌ **NOT USED** - Amazon's Choice object
- **`bestseller`** ❌ **NOT USED** - BestSeller badge object (we use `bestsellers_rank[]` instead)

### Links & Navigation
- **`link`** ❌ **NOT USED** - Product page link (we construct our own)
- **`other_formats[]`** ❌ **NOT USED** - Other format links (books/music)

### Product Details
- **`information`** ❌ **NOT USED** - Information text (pack quantity, etc.)
- **`unit_price`** ❌ **NOT USED** - Unit price string (e.g., "$0.57/Fl Oz")
- **`recent_sales`** ❌ **NOT USED** - Recent sales text (e.g., "200+ bought in past week")
- **`recent_views`** ❌ **NOT USED** - Recent views text (e.g., "300+ viewed in past week")

### Authors & Narrators (Media Products)
- **`authors[]`** ❌ **NOT USED** - Authors array (books/music/video)
- **`narrated_by[]`** ❌ **NOT USED** - Narrators array (Audible)

### Runtime (Audible)
- **`runtime`** ❌ **NOT USED** - Runtime object (Audible podcasts)

### Add-On Items
- **`add_on_item`** ❌ **NOT USED** - Add-on item object

### Availability
- **`availability`** ❌ **NOT USED** - Availability object (stock level data)
  - `availability.raw` ❌ **NOT USED** - Raw availability text

### Categories
- **`categories[]`** ❌ **NOT USED** - Categories array (shown next to search bar)
  - We get category from `bestsellers_rank[].category` instead

### Carousel Data
- **`is_carousel`** ❌ **NOT USED** - Carousel flag
- **`carousel`** ❌ **NOT USED** - Carousel object (title, sub_title, sponsored, id, total_items)

### Top-Level Arrays (Ignored)
- **`organic_results[]`** ❌ **NOT USED** - We only use `search_results[]` (contains both sponsored + organic)
- **`ads[]`** ❌ **NOT USED** - We only use `search_results[]`
- **`results[]`** ⚠️ **FALLBACK ONLY** - Used only if `search_results[]` is missing
- **`related_searches[]`** ❌ **NOT USED** - Related search suggestions
- **`related_brands[]`** ❌ **NOT USED** - Related brand objects
- **`ad_blocks[]`** ❌ **NOT USED** - Sponsored ad blocks
- **`video_blocks[]`** ❌ **NOT USED** - Video block objects
- **`shopping_advisors[]`** ❌ **NOT USED** - Shopping advisor sections

### Pagination
- **`pagination`** ❌ **NOT USED** - Pagination object
  - `pagination.total_results` ❌ **NOT USED** (we use `search_information.total_results`)
  - `pagination.current_page` ❌ **NOT USED**
  - `pagination.total_pages` ❌ **NOT USED**

### Refinements
- **`refinements`** ❌ **NOT USED** - Search refinement options

### Search Information (Partial)
- **`search_information.results_text_raw`** ❌ **NOT USED** - Raw results text
- **`search_information.results_being`** ❌ **NOT USED** - Starting position
- **`search_information.results_end`** ❌ **NOT USED** - Ending position
- **`search_information.search_term`** ❌ **NOT USED** - Search keyword (we already have it)

---

## Summary

### Total Properties Available: ~60+
### Properties We Use: ~20
### Properties We Ignore: ~40+

### Key Decisions:
1. **Single Array Source**: We ONLY read from `search_results[]`, ignoring `organic_results[]` and `ads[]`
2. **Sponsored Detection**: We ONLY use `item.sponsored` boolean (normalized to `isSponsored` at ingest)
3. **FBA Inference (CANONICAL)**: 
   - **PRIMARY**: `is_prime === true` → "FBA"
   - **SECONDARY**: `delivery.tagline` OR `delivery.text` contains "Prime", "Get it", or "Amazon" → "FBA"
   - **TERTIARY**: Delivery info exists → "FBM"
   - **FALLBACK**: "UNKNOWN" (mapped to "FBM" in CanonicalProduct)
   - This is market-level inference for competitive analysis, not checkout accuracy
   - We do NOT use SP-API or Offers API for fulfillment in Analyze flow
4. **BSR Priority**: We extract Rainforest BSR but SP-API Catalog BSR is authoritative
5. **Brand Resolution**: We use multiple brand fields (`brand`, `is_amazon_brand`, `is_exclusive_to_amazon`, `featured_from_our_brands`)
6. **Ratings/Reviews**: Rainforest is the ONLY source (SP-API doesn't provide these)

### Why We Ignore So Many Properties:
- **Badges**: Most badges (Kindle Unlimited, Prime Video, Small Business, etc.) are not relevant for market analysis
- **Carousels**: Carousel items are already included in `search_results[]` with their own position
- **Ad Blocks/Video Blocks**: These are separate ad units, not individual product listings
- **Related Searches/Brands**: Not relevant for Page-1 market analysis
- **Pagination**: We only analyze Page 1, so pagination data is irrelevant
- **Refinements**: We don't support search refinement in our analysis

---

## Notes

- **`ad_position`**: We extract this but it's not reliable from Rainforest. Sponsored position is better determined by position in `search_results[]`.
- **`seller`**: Not available in Rainforest search results (only in product pages)
- **`fulfillment`**: Not directly available in Rainforest search results. We infer using canonical logic:
  1. **PRIMARY**: `is_prime === true` → "FBA"
  2. **SECONDARY**: `delivery.tagline` OR `delivery.text` contains "Prime", "Get it", or "Amazon" → "FBA"
  3. **TERTIARY**: Delivery info exists → "FBM"
  4. **FALLBACK**: "UNKNOWN" (mapped to "FBM" in CanonicalProduct)
  
  This is market-level inference for competitive analysis, not checkout accuracy. We do NOT use SP-API or Offers API for fulfillment in Analyze flow.

