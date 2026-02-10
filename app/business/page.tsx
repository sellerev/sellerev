import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function BusinessPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth");
  }

  const { data: profile } = await supabase
    .from("seller_profiles")
    .select("id")
    .eq("id", user.id)
    .single();

  if (!profile) {
    redirect("/onboarding");
  }

  return (
    <div className="min-h-full w-full flex flex-col" style={{ backgroundColor: "#f3f4f6" }}>
      {/* Single white, bubbly, bordered content panel — fills entire content area */}
      <div className="flex-1 min-h-0 m-2 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden flex flex-col">
        <div className="flex-1 overflow-auto p-6 sm:p-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Business</h1>
            <p className="text-gray-600 mb-8">
              Business preferences and integrations.
            </p>

            {/* Connect Amazon */}
            <section className="pb-8 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">
                Connect Amazon
              </h2>
              <p className="text-sm text-gray-600 mb-4">
                Link your Seller Central account for more accurate fees and insights.
              </p>
              <Link
                href="/connect-amazon"
                className="inline-flex items-center rounded-xl bg-gradient-to-r from-primary to-primary-glow px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
              >
                Connect Amazon
              </Link>
            </section>

            {/* Business Settings */}
            <section className="pt-8">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">
                Business Settings
              </h2>
              <p className="text-gray-500 text-sm">
                Coming next — operating preferences, financial constraints, sourcing, and more in one place.
              </p>
            </section>
        </div>
      </div>
    </div>
  );
}
