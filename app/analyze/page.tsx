import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AnalyzeForm from "./AnalyzeForm";

export default async function AnalyzePage() {
  const supabase = await createClient();

  // Check authentication
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth");
  }

  // Check if seller profile exists
  const { data: profile } = await supabase
    .from("seller_profiles")
    .select("id")
    .eq("id", user.id)
    .single();

  if (!profile) {
    redirect("/onboarding");
  }

  // Only render if both checks pass
  return <AnalyzeForm />;
}
