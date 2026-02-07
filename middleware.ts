import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  // Early return for static assets (safety check)
  if (req.nextUrl.pathname.match(/\.(png|jpg|jpeg|svg|gif|webp|ico)$/)) {
    return NextResponse.next();
  }

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

  /** When false, skip Amazon OAuth flow; users go onboarding → analyze. */
  const oauthEnabled = process.env.NEXT_PUBLIC_ENABLE_AMAZON_OAUTH === "true";

  // Public pages that don't require authentication
  const publicPages = ["/", "/terms", "/privacy", "/support"];
  const isPublicPage = publicPages.includes(path);

  // Not logged in → allow public pages and auth page
  if (!user && !isAuth && !isPublicPage) {
    return NextResponse.redirect(new URL("/auth", req.url));
  }

  // Public pages: allow access without auth when NOT logged in
  if (!user && isPublicPage) {
    return res;
  }

  // Logged in → check onboarding / OAuth flow
  if (user) {
    const { data: profile } = await supabase
      .from("seller_profiles")
      .select("id, sourcing_model")
      .eq("id", user.id)
      .single();

    if (!oauthEnabled) {
      // OAuth disabled: never send users to connect-amazon. Onboarding → analyze.
      if (isConnectAmazon) {
        return NextResponse.redirect(new URL("/onboarding", req.url));
      }
      if (!profile && !isOnboarding && !isAuth) {
        // No profile yet → always send to onboarding (even from "/")
        return NextResponse.redirect(new URL("/onboarding", req.url));
      }
      if (profile) {
        // Has profile: onboarding complete → send to analyze if they hit onboarding or home
        if (isOnboarding) {
          return NextResponse.redirect(new URL("/analyze", req.url));
        }
        if (isAuth || path === "/") {
          return NextResponse.redirect(new URL("/analyze", req.url));
        }
      }
      return res;
    }

    // OAuth enabled: original flow (connect-amazon when no profile or missing sourcing_model)
    if (!profile || !profile.sourcing_model) {
      if (!isConnectAmazon && !isOnboarding && !isAuth) {
        // No profile/sourcing_model yet → send to connect-amazon (even from "/")
        return NextResponse.redirect(new URL("/connect-amazon", req.url));
      }
    } else {
      // Has profile/sourcing_model: onboarding complete
      if (profile.sourcing_model && isOnboarding) {
        return NextResponse.redirect(new URL("/analyze", req.url));
      }
      if (profile.sourcing_model && (isAuth || isConnectAmazon || path === "/")) {
        return NextResponse.redirect(new URL("/analyze", req.url));
      }
    }
  }

  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp)).*)",
  ],
};