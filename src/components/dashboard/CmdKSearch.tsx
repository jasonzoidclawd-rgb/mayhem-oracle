"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { localizedName, type LocalizedNameRecord } from "@/lib/i18n/localized-name";

type SearchItem = LocalizedNameRecord & { kind: "champion" | "augment" };

const KIND_ICON: Record<SearchItem["kind"], string> = { champion: "🧙", augment: "◆" };

export function CmdKSearch() {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchItem[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Lazy-load the search corpus only once the palette is actually opened.
  useEffect(() => {
    if (!open || items) return;
    Promise.all([
      fetch("/data/champions.json").then((r) => r.json()),
      fetch("/data/augments.json").then((r) => r.json()),
    ]).then(([champData, augData]) => {
      const champItems: SearchItem[] = champData.champions.map((c: LocalizedNameRecord) => ({
        name: c.name,
        name_zh_TW: c.name_zh_TW,
        name_zh_CN: c.name_zh_CN,
        name_ja: c.name_ja,
        name_ko: c.name_ko,
        kind: "champion" as const,
      }));
      const augItems: SearchItem[] = augData.augments.map((a: LocalizedNameRecord) => ({
        name: a.name,
        name_zh_TW: a.name_zh_TW,
        name_zh_CN: a.name_zh_CN,
        name_ja: a.name_ja,
        name_ko: a.name_ko,
        kind: "augment" as const,
      }));
      setItems([...champItems, ...augItems]);
    });
  }, [open, items]);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(id);
  }, [open]);

  const openPalette = () => {
    setQuery("");
    setOpen(true);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) {
          setOpen(false);
        } else {
          setQuery("");
          setOpen(true);
        }
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const q = query.toLowerCase();
  const results = (items ?? [])
    .filter((item) => localizedName(item, locale).toLowerCase().includes(q))
    .slice(0, 8);

  return (
    <>
      <button
        type="button"
        onClick={openPalette}
        aria-label={t("searchTriggerLabel")}
        className="flex h-9 items-center gap-2 rounded-lg border border-[var(--color-border-default)]
                   bg-[var(--color-bg-card)] px-3 text-xs text-[var(--color-text-secondary)]
                   transition-colors hover:border-[var(--color-border-hover)]"
      >
        <span aria-hidden="true">🔍</span>
        <span className="hidden lg:inline">{t("searchTriggerLabel")}</span>
        <span className="hidden rounded border border-[var(--color-border-default)] px-1.5 py-px text-[11px] text-[var(--color-text-muted)] lg:inline">
          ⌘K
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 pt-[12vh] backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-label={t("searchTriggerLabel")}
            className="w-[min(620px,92vw)] overflow-hidden rounded-2xl border border-[var(--color-border-hover)]
                       bg-[var(--color-bg-card)] shadow-2xl"
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              autoComplete="off"
              className="w-full border-b border-[var(--color-border-default)] bg-transparent px-4 py-4 text-base
                         text-[var(--color-text-primary)] outline-none"
            />
            <div className="max-h-[46vh] overflow-auto p-1.5">
              {results.length > 0 ? (
                results.map((item, i) => (
                  <div
                    key={`${item.kind}-${item.name}-${i}`}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-white/5"
                  >
                    <span aria-hidden="true">{KIND_ICON[item.kind]}</span>
                    <span>{localizedName(item, locale)}</span>
                    <span className="ml-auto text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                      {item.kind === "champion" ? t("searchKindChampion") : t("searchKindAugment")}
                    </span>
                  </div>
                ))
              ) : (
                <div className="px-3 py-2.5 text-[var(--color-text-muted)]">
                  {t("searchNoResults", { query })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
