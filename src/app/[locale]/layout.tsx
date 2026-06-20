import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing, isSupportedLocale } from "@/i18n/routing";
import { SITE_URL, localizedUrl, languageAlternates } from "@/lib/site";
import { Navbar } from "@/components/ui/Navbar";
import { NavigationProgress } from "@/components/ui/NavigationProgress";
import { ConsentManager } from "@/components/ads/ConsentManager";
import { Footer } from "@/components/ui/Footer";
import "@/styles/globals.css";

// Latin UI font. CJK locales fall through to the platform CJK stack defined in
// globals.css (PingFang / JhengHei / Noto Sans CJK), so we don't ship CJK webfonts.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

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
  const title = t("title");
  const description = t("description");

  return {
    metadataBase: new URL(SITE_URL),
    title: {
      template: `%s | ${title}`,
      default: title,
    },
    description,
    manifest: "/manifest.json",
    alternates: {
      canonical: localizedUrl("/", locale),
      languages: languageAlternates("/"),
    },
    openGraph: {
      type: "website",
      siteName: "Mayhem Oracle",
      title,
      description,
      url: localizedUrl("/", locale),
      locale,
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "Mayhem Oracle" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og.png"],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
    },
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
  const tm = await getTranslations({ locale, namespace: "membership" });
  const tmeta = await getTranslations({ locale, namespace: "metadata" });

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Mayhem Oracle",
    url: SITE_URL,
    description: tmeta("description"),
    inLanguage: routing.locales,
    publisher: {
      "@type": "Organization",
      name: "Mayhem Oracle",
      url: SITE_URL,
    },
  };

  return (
    <html lang={locale} className={`dark ${inter.variable}`}>
      <body className="min-h-screen bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
        />
        <NextIntlClientProvider messages={messages}>
          <NavigationProgress />
          <Navbar />
          <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-20 pb-12">
            {children}
          </main>
          <Footer />
          <ConsentManager
            copy={{
              title: tm("consentTitle"),
              body: tm("consentBody"),
              accept: tm("consentAccept"),
              decline: tm("consentDecline"),
              privacyLink: tm("privacyLink"),
            }}
          />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
