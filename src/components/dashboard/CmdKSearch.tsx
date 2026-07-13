"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { localizedName, type LocalizedNameRecord } from "@/lib/i18n/localized-name";
import {
  buildPatchNoteSearchItems,
  type PatchNoteSearchItem,
} from "@/lib/patch-notes/search";
import type { PatchNotesData } from "@/lib/types";
import { resolveEntityRef } from "@/lib/entities/catalog";
import type { EntityPresentationData, EntityRef } from "@/lib/entities/types";
import { projectVisibleItemCatalog } from "@/lib/items/catalog";
import type { Item } from "@/lib/types";
import { EntityLink } from "@/components/entities/EntityLink";

type SearchItem = LocalizedNameRecord & {
  kind: "champion" | "augment" | "item" | "patch-note";
  icon?: string;
  href?: string;
  entity?: EntityRef;
  snippet?: string;
  searchText?: string;
};

type CatalogNameRecord = LocalizedNameRecord & {
  slug: string;
  icon?: string;
};

export function CmdKSearch() {
  const t = useTranslations("dashboard");
  const tPatch = useTranslations("patchNotes");
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
      fetch("/data/items.json").then((r) => r.json()),
      fetch("/data/entity-presentation.json").then((r) => r.json() as Promise<EntityPresentationData>),
      fetch("/data/patch-notes.json")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([champData, augData, itemData, entityData, patchData]) => {
      const champItems: SearchItem[] = champData.champions.map((c: CatalogNameRecord) => ({
        name: c.name,
        name_zh_TW: c.name_zh_TW,
        name_zh_CN: c.name_zh_CN,
        name_ja: c.name_ja,
        name_ko: c.name_ko,
        kind: "champion" as const,
        icon: c.icon,
        entity: resolveEntityRef(entityData, "champion", { slug: c.slug }, locale) ?? undefined,
      }));
      const augItems: SearchItem[] = augData.augments.map((a: CatalogNameRecord) => ({
        name: a.name,
        name_zh_TW: a.name_zh_TW,
        name_zh_CN: a.name_zh_CN,
        name_ja: a.name_ja,
        name_ko: a.name_ko,
        kind: "augment" as const,
        icon: a.icon,
        entity: resolveEntityRef(entityData, "augment", { slug: a.slug }, locale) ?? undefined,
      }));
      const visibleItems = projectVisibleItemCatalog({
        items: (itemData.items ?? []) as Item[],
        mayhemExclusive: (itemData.mayhemExclusive ?? []) as Item[],
      });
      const itemItems: SearchItem[] = [
        ...visibleItems.mayhemExclusive,
        ...visibleItems.items,
      ].map((item: LocalizedNameRecord & { id?: number; slug?: string; icon?: string }) => ({
        name: item.name,
        name_zh_TW: item.name_zh_TW,
        name_zh_CN: item.name_zh_CN,
        name_ja: item.name_ja,
        name_ko: item.name_ko,
        kind: "item" as const,
        icon: item.icon,
        entity: resolveEntityRef(entityData, "item", { canonicalId: item.id != null ? String(item.id) : undefined, slug: item.slug }, locale) ?? undefined,
      }));
      const patchItems: PatchNoteSearchItem[] = buildPatchNoteSearchItems(
        patchData as PatchNotesData | null,
        locale,
        { patchLabel: (patch) => tPatch("patchLabel", { patch }) },
      );
      setItems([...champItems, ...augItems, ...itemItems, ...patchItems]);
    });
  }, [open, items, locale, tPatch]);

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
    .filter((item) =>
      (item.searchText ?? localizedName(item, locale)).toLowerCase().includes(q),
    )
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
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="h-4 w-4"
          fill="none"
        >
          <path
            d="M8.5 14.5a6 6 0 1 1 4.24-1.76L17 17"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        <span className="hidden lg:inline">{t("searchTriggerLabel")}</span>
        <span className="hidden rounded border border-[var(--color-border-default)] px-1.5 py-px text-[11px] text-[var(--color-text-muted)] lg:inline">
          ⌘K / Ctrl K
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
                  <SearchResult
                    key={`${item.kind}-${item.name}-${i}`}
                    item={item}
                    locale={locale}
                    kindLabel={
                      item.kind === "champion"
                        ? t("searchKindChampion")
                        : item.kind === "augment"
                          ? t("searchKindAugment")
                          : item.kind === "item"
                            ? t("searchKindItem")
                            : t("searchKindPatchNote")
                    }
                    onSelect={() => setOpen(false)}
                  />
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

function SearchResult({
  item,
  locale,
  kindLabel,
  onSelect,
}: {
  item: SearchItem;
  locale: string;
  kindLabel: string;
  onSelect: () => void;
}) {
  const content = (
    <>
      {item.icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.icon}
          alt=""
          className="h-8 w-8 shrink-0 rounded-md object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span
          aria-hidden="true"
          className="h-8 w-8 shrink-0 rounded-md border border-[var(--color-border-default)] bg-white/5"
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{localizedName(item, locale)}</span>
        {item.snippet ? (
          <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
            {item.snippet}
          </span>
        ) : null}
      </span>
      <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
        {kindLabel}
      </span>
    </>
  );
  const className = "flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-white/5";

  if (item.entity) {
    return <EntityLink entity={item.entity} variant="standard" className={className} />;
  }

  if (item.href) {
    return (
      <a href={localizedHref(item.href, locale)} className={className} onClick={onSelect}>
        {content}
      </a>
    );
  }

  return <div className={className}>{content}</div>;
}

function localizedHref(href: string, locale: string): string {
  if (locale === "en" || !href.startsWith("/")) return href;
  return `/${locale}${href}`;
}
