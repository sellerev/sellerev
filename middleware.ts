import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  let res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
  const isOnboarding = path.startsWith("/onboarding");

  // Not logged in → auth
  if (!user && !isAuth) {
    return NextResponse.redirect(new URL("/auth", req.url));
  }

  // Logged in → check onboarding
  if (user) {
    const { data: profile } = await supabase
      .from("seller_profiles")
      .select("id, sourcing_model")
      .eq("id", user.id)
      .single();

    // No profile yet OR missing sourcing_model → force onboarding
    if ((!profile || !profile.sourcing_model) && !isOnboarding) {
      return NextResponse.redirect(new URL("/onboarding", req.url));
    }

    // Profile exists with sourcing_model → block auth + onboarding
    if (profile && profile.sourcing_model && (isAuth || isOnboarding)) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};