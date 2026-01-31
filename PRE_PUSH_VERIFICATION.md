# Pre-push verification checklist

## 1. Admin invalidate endpoint security

**Route:** `POST /api/admin/invalidate-keyword-cache`

**Code verified:**
- **Prod:** When `NODE_ENV !== "development"`, the route requires `x-admin-secret` header matching `ADMIN_SECRET`; returns **401** if header missing or wrong, **403** if `ADMIN_SECRET` is unset.
- **Dev:** When `NODE_ENV === "development"`, no secret is required.
- **No secret logging:** `adminSecret` and `headerSecret` are never passed to `console.log` or any logger (grep confirms only comparison usage).

**Before pushing:**
- [ ] **Vercel:** Ensure `NODE_ENV` is set to `production` in production (Vercel sets this automatically; no action if using default).
- [ ] **Vercel:** Add `ADMIN_SECRET` to Project → Settings → Environment Variables for **Production** (and optionally Preview if you want to protect preview deployments).
- [ ] **Quick test (after deploy):**  
  `curl -X POST https://<your-vercel-domain>/api/admin/invalidate-keyword-cache -H "Content-Type: application/json" -d '{"keyword":"test"}'`  
  Expect **401 Unauthorized** (no header). With valid `x-admin-secret`, expect 200 and `{"ok":true,...}`.

---

## 2. Cache key change – no “instant blank UI”

**Code verified:** `lib/amazon/keywordCache.ts` → `cacheKeywordAnalysis`

- Writes to `keyword_analysis_cache` **only** when `data.listings` is a non-empty array (`Array.isArray(listings) && listings.length > 0`).
- If empty or missing, it logs `KEYWORD_CACHE_SKIP_EMPTY` and **returns without writing** (no empty payload cached).
- Cache hits always return `data.listings` from a row that was only ever written when listings had length > 0.

**No code change needed.** No “empty” status is stored; we simply never cache empty payloads, so they can never be treated as a valid hit.

---

## 3. Response shape the UI expects

**Backend:** `app/api/analyze/route.ts` (success response, ~3806–3809)

- The API returns **all three keys** set to the same array:
  - `page_one_listings: sanitizedListings`
  - `products: sanitizedListings`
  - `listings: sanitizedListings`

**Frontend:**

- **AnalyzeForm.tsx:** Uses `page_one_listings || products || listings` (e.g. line 1043, 823, 1162–1163, 1501–1511, 2801).
- **analyze/page.tsx** and **analyze/[analysis_run_id]/page.tsx:** Same fallback chain: `page_one_listings` → `products` → `listings`.

So the UI reads the same array regardless of which key it uses; backend sends all three with the same value. No mismatch.

---

## Summary

| Check                         | Status | Action |
|------------------------------|--------|--------|
| Admin route prod auth        | OK     | Set `ADMIN_SECRET` on Vercel prod; test 401 without header after deploy. |
| No empty cache writes        | OK     | None. |
| Response shape consistency   | OK     | None. |
