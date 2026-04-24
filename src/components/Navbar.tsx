"use client";

import { useTranslations, useLocale } from "next-intl";
import { useRouter, usePathname, Link } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { useState } from "react";

const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "zh-TW": "繁體中文",
  "zh-CN": "简体中文",
  ja: "日本語",
  ko: "한국어",
};

const NAV_ITEMS = [
  { href: "/tier-list", key: "tierList" },
  { href: "/augments", key: "augments" },
  { href: "/items", key: "items" },
  { href: "/damage-sim", key: "damageSim" },
  { href: "/patch-notes", key: "patchNotes" },
] as const;

export function Navbar() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const switchLocale = (newLocale: string) => {
    router.replace(pathname, { locale: newLocale as Locale });
  };

  return (
    <nav className="fixed top-0 inset-x-0 z-50 border-b border-[var(--color-border-default)] bg-[var(--color-bg-primary)]/80 backdrop-blur-lg">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex items-center justify-between h-14">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-bold text-lg">
          <span className="text-[var(--color-neon-primary)]">⚡</span>
          <span className="hidden sm:inline">Mayhem Oracle</span>
          <span className="sm:hidden">MO</span>
        </Link>

        {/* Desktop nav links */}
        <div className="hidden sm:flex items-center gap-6">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              {t(item.key)}
            </Link>
          ))}
        </div>

        {/* Language switcher + mobile menu toggle */}
        <div className="flex items-center gap-3">
          <select
            value={locale}
            onChange={(e) => switchLocale(e.target.value)}
            className="text-xs bg-[var(--color-bg-card)] text-[var(--color-text-secondary)]
                       border border-[var(--color-border-default)] rounded-md px-2 py-1.5
                       hover:border-[var(--color-border-hover)] transition-colors cursor-pointer"
          >
            {routing.locales.map((loc) => (
              <option key={loc} value={loc}>
                {LOCALE_LABELS[loc]}
              </option>
            ))}
          </select>

          {/* Mobile hamburger */}
          <button
            className="sm:hidden text-[var(--color-text-secondary)]"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              {menuOpen ? (
                <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
              ) : (
                <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="sm:hidden border-t border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-4 py-3">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="block py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              onClick={() => setMenuOpen(false)}
            >
              {t(item.key)}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
