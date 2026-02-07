import { redirect } from "next/navigation";

/**
 * Dashboard is being redesigned. For now, always send users to Analyze.
 */
export default function DashboardPage() {
  redirect("/analyze");
}
