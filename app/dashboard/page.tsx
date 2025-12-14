import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = createClient();

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
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Sellerev Dashboard</h1>
      <p className="text-gray-400">
        Dashboard placeholder. Go to /analyze to test Feature 1.
      </p>
    </div>
  );
}