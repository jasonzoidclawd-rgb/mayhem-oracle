import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing, isSupportedLocale } from "@/i18n/routing";
import { Navbar } from "@/components/ui/Navbar";
import { NavigationProgress } from "@/components/ui/NavigationProgress";
import { Footer } from "@/components/ui/Footer";
import "@/styles/globals.css";

export const dynamicParams = false;

// Generate static params for all locales (enables static rendering)
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Dynamic metadata per locale
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();

  const t = await getTranslations({ locale, namespace: "metadata" });

  return {
    title: {
      template: `%s | ${t("title")}`,
      default: t("title"),
    },
    description: t("description"),
    manifest: "/manifest.json",
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "Mayhem Oracle",
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0e17",
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();

  // Enable static rendering for this layout
  setRequestLocale(locale);

  // Load all messages for client components
  const messages = await getMessages();

  return (
    <html lang={locale} className="dark">
      <body className="min-h-screen bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
        <NextIntlClientProvider messages={messages}>
          <NavigationProgress />
          <Navbar />
          <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-20 pb-12">
            {children}
          </main>
          <Footer />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
