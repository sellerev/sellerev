import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BusinessPageClient from "./BusinessPageClient";

export default async function BusinessPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth");
  }

  return <BusinessPageClient />;
}
