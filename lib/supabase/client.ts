import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Create client only if env vars are present (prevents build errors)
// During build, if env vars are missing, this will be undefined
// Client components should handle this gracefully
export const supabaseBrowser = supabaseUrl && supabaseAnonKey
  ? createBrowserClient(supabaseUrl, supabaseAnonKey)
  : undefined as any; // Type assertion for build-time compatibility