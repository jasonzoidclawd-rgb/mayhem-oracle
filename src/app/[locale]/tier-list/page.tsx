import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

// The tier list is now a view inside the unified /champions dashboard.
// Preserve the old URL for SEO/bookmarks by redirecting to /champions.
export default async function TierListPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  redirect({ href: "/champions", locale });
}
