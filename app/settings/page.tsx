import { redirect } from "next/navigation";

/**
 * Business preferences moved to /business (single page, no tabs).
 * Redirect old /settings links to /business.
 */
export default function SettingsPage() {
  redirect("/business");
}
