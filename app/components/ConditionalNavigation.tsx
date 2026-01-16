"use client";

import { usePathname } from "next/navigation";
import Navigation from "./Navigation";

export default function ConditionalNavigation() {
  const pathname = usePathname();
  const publicPages = ["/", "/terms", "/privacy", "/support"];
  const isPublicPage = publicPages.includes(pathname || "");

  // Public pages handle their own navigation, so return null
  if (isPublicPage) {
    return null;
  }

  return <Navigation />;
}

