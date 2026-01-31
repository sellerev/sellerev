import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { invalidateKeywordCache } from "@/lib/amazon/keywordCache";

/**
 * POST /api/admin/invalidate-keyword-cache
 * Deletes the keyword_analysis_cache row for the given keyword/marketplace.
 * Use to clear poisoned or stale cache (e.g. "food warming mat").
 *
 * Security:
 * - Production: requires x-admin-secret header === ADMIN_SECRET env. If ADMIN_SECRET is unset in prod, returns 403.
 * - Development: no secret required (NODE_ENV=development). Ensure Vercel prod has NODE_ENV=production and ADMIN_SECRET set.
 * - Never log the secret.
 */
export async function POST(req: NextRequest) {
  const isDev = process.env.NODE_ENV === "development";
  const adminSecret = process.env.ADMIN_SECRET;
  const headerSecret = req.headers.get("x-admin-secret");

  if (!isDev) {
    if (!adminSecret) {
      return NextResponse.json(
        { error: "Admin endpoint not configured (ADMIN_SECRET missing in production)." },
        { status: 403 }
      );
    }
    if (headerSecret !== adminSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: { keyword?: string; marketplace?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body. Expected { keyword: string, marketplace?: string }" },
      { status: 400 }
    );
  }

  const keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
  if (!keyword) {
    return NextResponse.json({ error: "keyword is required" }, { status: 400 });
  }
  const marketplace = typeof body.marketplace === "string" ? body.marketplace.trim() || "US" : "US";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Server not configured for cache invalidation" }, { status: 500 });
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const result = await invalidateKeywordCache(supabase, keyword, marketplace);
  return NextResponse.json({ ok: true, ...result });
}
