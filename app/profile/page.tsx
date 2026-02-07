import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ProfilePageClient from "./ProfilePageClient";

export default async function ProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth");
  }

  return (
    <ProfilePageClient
      user={{
        id: user.id,
        email: user.email ?? "",
        user_metadata: user.user_metadata ?? {},
      }}
    />
  );
}
