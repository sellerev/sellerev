# Amazon SP-API OAuth Environment Variables Checklist

## Required Environment Variables

Add these to your **Vercel** project settings and **`.env.local`** for local development.

### Supabase (Already Configured)
- ✅ `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
- ✅ `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key (public)
- ✅ `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (server-only, never expose to client)

### Application URL
- ✅ `NEXT_PUBLIC_APP_URL` - Your application URL (e.g., `https://sellerev.vercel.app`)
  - **Fallback**: If not set, uses `VERCEL_URL` environment variable (automatically set by Vercel)
  - **Local**: For local development, use `http://localhost:3000`

### Amazon SP-API / Login with Amazon
- ✅ `SP_API_LWA_CLIENT_ID` or `SP_API_CLIENT_ID` - LWA (Login with Amazon) Client ID
  - Get this from your SP-API app in Seller Central
- ✅ `SP_API_LWA_CLIENT_SECRET` or `SP_API_CLIENT_SECRET` - LWA Client Secret
  - Get this from your SP-API app in Seller Central
- ✅ `SP_API_REFRESH_TOKEN` - Developer refresh token (fallback when user hasn't connected)
  - This is your existing developer token
  - Used as fallback when users haven't connected their own accounts

### AWS Credentials (Already Configured)
- ✅ `SP_API_AWS_ACCESS_KEY_ID` - AWS IAM user access key
- ✅ `SP_API_AWS_SECRET_ACCESS_KEY` - AWS IAM user secret key
- ✅ `SP_API_SELLING_PARTNER_ROLE_ARN` - IAM role ARN for SP-API
- ✅ `SP_API_AWS_REGION` - AWS region (usually `us-east-1`)

### Marketplace
- ✅ `SP_API_MARKETPLACE_ID` - Default marketplace ID (e.g., `ATVPDKIKX0DER` for US)

### Token Encryption (NEW - REQUIRED)
- ✅ `AMAZON_TOKEN_ENCRYPTION_KEY` - 32-byte encryption key, base64 encoded
  - **Generate**: Run `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
  - **Store securely**: Never commit to git, only in Vercel environment variables
  - **Format**: Base64-encoded 32-byte key

## Verification Steps

1. **Generate Encryption Key**:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   Copy the output and add it to `AMAZON_TOKEN_ENCRYPTION_KEY`

2. **Verify OAuth Redirect URI**:
   - In Amazon Seller Central → SP-API App settings
   - Add redirect URI: `https://your-domain.com/api/amazon/callback`
   - For local dev: `http://localhost:3000/api/amazon/callback`

3. **Test Connection Flow**:
   - Navigate to Settings → Integrations
   - Click "Connect Amazon"
   - Complete OAuth flow
   - Verify connection status shows "Connected"

## Migration Required

Run the Supabase migration to create the `amazon_connections` table:

```bash
# If using Supabase CLI locally
supabase migration up

# Or apply migration manually in Supabase dashboard
# File: supabase/migrations/20260120_add_amazon_connections.sql
```

## Troubleshooting

### "SP-API credentials not configured"
- Check that `SP_API_LWA_CLIENT_ID` and `SP_API_LWA_CLIENT_SECRET` are set
- Verify variable names match exactly (case-sensitive)

### "AMAZON_TOKEN_ENCRYPTION_KEY environment variable is required"
- Generate a new key using the command above
- Add it to Vercel environment variables
- Restart your deployment

### OAuth redirect fails
- Verify redirect URI matches exactly in Amazon Seller Central
- Check that `NEXT_PUBLIC_APP_URL` is set correctly
- Ensure HTTPS is used in production (Amazon requires HTTPS for OAuth)

### 403 errors persist after connecting
- Verify the user's refresh token was stored correctly
- Check that the SP-API app has Pricing and Fees API access enabled
- Verify IAM role policies allow access to these APIs

