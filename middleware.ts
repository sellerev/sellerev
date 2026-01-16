import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  let res = NextResponse.next();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Skip middleware if env vars are missing (e.g., during build)
  if (!supabaseUrl || !supabaseAnonKey) {
    return res;
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = req.nextUrl.pathname;

  const isAuth = path.startsWith("/auth");
  const isConnectAmazon = path.startsWith("/connect-amazon");
  const isOnboarding = path.startsWith("/onboarding");
  
  // Public pages that don't require authentication
  const publicPages = ["/", "/terms", "/privacy", "/support"];
  const isPublicPage = publicPages.includes(path);

  // Not logged in → allow public pages and auth page
  if (!user && !isAuth && !isPublicPage) {
    return NextResponse.redirect(new URL("/auth", req.url));
  }
  
  // Public pages: allow access without auth
  if (isPublicPage) {
    return res;
  }

  // Logged in → check onboarding flow
  if (user) {
    const { data: profile } = await supabase
      .from("seller_profiles")
      .select("id, sourcing_model")
      .eq("id", user.id)
      .single();

    // No profile yet OR missing sourcing_model → allow connect-amazon or onboarding
    if (!profile || !profile.sourcing_model) {
      // Allow connect-amazon and onboarding steps
      if (!isConnectAmazon && !isOnboarding && !isAuth) {
        // First time: redirect to connect-amazon
        return NextResponse.redirect(new URL("/connect-amazon", req.url));
      }
    } else {
      // Profile exists with sourcing_model → block auth, connect-amazon, and onboarding
      if (profile && profile.sourcing_model && (isAuth || isConnectAmazon || isOnboarding)) {
        return NextResponse.redirect(new URL("/analyze", req.url));
      }
    }
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};