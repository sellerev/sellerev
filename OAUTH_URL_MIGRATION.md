# OAuth URL Migration to sellerev.com

## Summary

All OAuth URLs have been normalized to use `https://sellerev.com` in production. The codebase now uses a single source of truth for app URLs.

---

## Task A: OAuth URL Locations Found

### Files Modified:
1. **`app/api/amazon/connect/route.ts`** (Lines 32-34, 57)
   - Previously used: `process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL ? https://${process.env.VERCEL_URL} : "http://localhost:3000"`
   - Now uses: `getOAuthCallbackUrl()` utility

2. **`app/api/amazon/callback/route.ts`** (Lines 72-75)
   - Previously used: Same fallback chain with VERCEL_URL
   - Now uses: `getOAuthCallbackUrl()` utility

### Files Created:
- **`lib/utils/appUrl.ts`** - Single source of truth for app URLs

### Other References Found (Not OAuth-related):
- `AMAZON_OAUTH_ENV_CHECKLIST.md` - Documentation (contains example vercel.app URL)
- `app/analyze/AnalyzeForm.tsx` - Localhost safety checks (not OAuth)
- Various Supabase URL references (not OAuth-related)

---

## Task B: OAuth Callback Handler

**Route:** `/api/amazon/callback`  
**File:** `app/api/amazon/callback/route.ts`  
**Handler:** `GET` function starting at line 13

This route:
- Validates OAuth state token
- Exchanges authorization code for refresh token
- Stores encrypted refresh token in database
- Redirects user to settings or onboarding flow

---

## Task C: URL Normalization Implementation

### Single Source of Truth
Created `lib/utils/appUrl.ts` with two functions:

1. **`getAppUrl()`** - Returns base application URL
   - Production: `https://sellerev.com`
   - Development: `process.env.NEXT_PUBLIC_APP_URL || http://localhost:3000`

2. **`getOAuthCallbackUrl()`** - Returns OAuth callback URL
   - Returns: `${getAppUrl()}/api/amazon/callback`
   - Production: `https://sellerev.com/api/amazon/callback`
   - Development: `http://localhost:3000/api/amazon/callback`

### Updated Routes
Both OAuth routes now use the utility function:
- `app/api/amazon/connect/route.ts` - Uses `getOAuthCallbackUrl()`
- `app/api/amazon/callback/route.ts` - Uses `getOAuthCallbackUrl()`

### Environment Variables
- `NEXT_PUBLIC_APP_URL` - Optional, used in development
- `VERCEL_URL` - **No longer used** for OAuth (ignored in production)
- `NODE_ENV` - Determines production vs development

---

## Task D: Amazon Solution Provider Portal URLs

### OAuth Login URI
```
https://sellerev.com/login
```
**This is your application's entry point where Amazon reviewers start the OAuth flow.**

### OAuth Redirect URI
```
https://sellerev.com/api/amazon/callback
```
**This is the callback URL where Amazon returns after user consent.**

### Additional Notes
- **OAuth Login URI** = Your app's entry point (where Amazon reviewers start)
- **OAuth Redirect URI** = Callback endpoint (where Amazon returns after consent)
- Both URLs must match **exactly** what's registered in Amazon's portal
- No trailing slashes
- Must use `https://` (not `http://`)
- Must be the exact domain `sellerev.com` (no subdomains, no vercel.app)
- **Do NOT use Amazon-owned Seller Central URLs** as the Login URI

---

## Task E: Production Verification

### Enhanced Logging
Both OAuth routes now log computed URLs at runtime:

**Connect Route Logs:**
```javascript
{
  redirect_uri: "https://sellerev.com/api/amazon/callback",
  computed_base_url: "https://sellerev.com",
  environment: "production",
  vercel_url_env: "not set" or actual value,
  next_public_app_url_env: "not set" or actual value
}
```

**Callback Route Logs:**
```javascript
{
  redirect_uri_used: "https://sellerev.com/api/amazon/callback",
  computed_base_url: "https://sellerev.com",
  environment: "production"
}
```

### Debug Endpoint
Created `/api/debug/oauth-urls` endpoint for verification:

**Access:**
- Development: Always available at `http://localhost:3000/api/debug/oauth-urls`
- Production: Set `ENABLE_OAUTH_DEBUG=true` to enable

**Response:**
```json
{
  "environment": "production",
  "computed_urls": {
    "base_url": "https://sellerev.com",
    "oauth_callback_url": "https://sellerev.com/api/amazon/callback"
  },
  "environment_variables": {
    "NEXT_PUBLIC_APP_URL": "not set" or actual value,
    "VERCEL_URL": "not set" or actual value,
    "NODE_ENV": "production"
  },
  "amazon_portal_urls": {
    "oauth_login_uri": "https://sellerev.com/login",
    "oauth_redirect_uri": "https://sellerev.com/api/amazon/callback",
    "note": "OAuth Login URI is where Amazon reviewers start in our app. OAuth Redirect URI is the callback where Amazon returns after consent."
  }
}
```

---

## Verification Steps

1. **Check Logs After Deploy:**
   - Trigger OAuth flow and check server logs
   - Verify `redirect_uri` shows `https://sellerev.com/api/amazon/callback`
   - Verify `computed_base_url` shows `https://sellerev.com`

2. **Use Debug Endpoint (if enabled):**
   ```bash
   curl https://sellerev.com/api/debug/oauth-urls
   ```
   Or visit in browser (if `ENABLE_OAUTH_DEBUG=true`)

3. **Verify Amazon Portal:**
   - Log into Amazon Solution Provider Portal
   - Check that **OAuth Login URI** is exactly: `https://sellerev.com/login`
   - Check that **OAuth Redirect URI** is exactly: `https://sellerev.com/api/amazon/callback`
   - Ensure no vercel.app URLs are present
   - Ensure no Amazon Seller Central URLs are used as Login URI

---

## Environment Variable Checklist

### Required for Production:
- ✅ `NODE_ENV=production` (automatically set by Vercel)
- ✅ No `VERCEL_URL` dependency (ignored for OAuth)
- ⚠️ `NEXT_PUBLIC_APP_URL` - Optional, not used in production (hardcoded to sellerev.com)

### Required for OAuth:
- ✅ `SP_API_APPLICATION_ID` or `SP_API_APP_ID` - SP-API Application ID
- ✅ `SP_API_CLIENT_ID` or `SP_API_LWA_CLIENT_ID` - LWA Client ID
- ✅ `SP_API_CLIENT_SECRET` or `SP_API_LWA_CLIENT_SECRET` - LWA Client Secret

---

## Breaking Changes

⚠️ **Important:** The code now **ignores** `VERCEL_URL` for OAuth URLs in production. If you were relying on Vercel's automatic URL detection, you must ensure `NODE_ENV=production` is set correctly.

---

## Testing

### Local Development:
1. Set `NEXT_PUBLIC_APP_URL=http://localhost:3000` (optional)
2. OAuth will use `http://localhost:3000/api/amazon/callback`
3. Test OAuth flow locally

### Production:
1. Deploy to production
2. OAuth will automatically use `https://sellerev.com/api/amazon/callback`
3. Verify in logs that URLs are correct
4. Test OAuth flow in production

---

## Files Changed

- ✅ `lib/utils/appUrl.ts` - **NEW** - URL utility functions
- ✅ `app/api/amazon/connect/route.ts` - Updated to use utility
- ✅ `app/api/amazon/callback/route.ts` - Updated to use utility
- ✅ `app/api/debug/oauth-urls/route.ts` - **NEW** - Debug endpoint

---

## Next Steps

1. ✅ Update Amazon Solution Provider Portal with new Redirect URI
2. ✅ Deploy to production
3. ✅ Verify OAuth flow works with sellerev.com
4. ✅ Check server logs to confirm URLs are correct
5. ✅ Remove any old vercel.app URLs from Amazon portal

