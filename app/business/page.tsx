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
    <div className="min-h-full" style={{ backgroundColor: "#f3f4f6" }}>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Business</h1>
        <p className="text-gray-600 mb-8">
          Business preferences and integrations.
        </p>

        {/* Connect Amazon — top section */}
        <section className="mb-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
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

        {/* Placeholder for future business settings */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            Business Settings
          </h2>
          <p className="text-gray-500 text-sm">
            Coming next — operating preferences, financial constraints, sourcing, and more in one place.
          </p>
        </section>
      </div>
    </div>
  );
}
