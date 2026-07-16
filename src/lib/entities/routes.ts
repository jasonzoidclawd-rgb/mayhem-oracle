import type { Locale } from "@/i18n/routing";
import type { EntityRef } from "./types";

export interface EntityRouteCatalogs {
  champions: ReadonlyArray<{ slug?: string | null }>;
  augments: ReadonlyArray<{ slug?: string | null }>;
  items: {
    readonly items: ReadonlyArray<{ id?: number | string | null }>;
    readonly mayhemExclusive: ReadonlyArray<{ slug?: string | null }>;
  };
}

export type EntityRouteSets = Readonly<{
  champion: ReadonlySet<string>;
  augment: ReadonlySet<string>;
  item: ReadonlySet<string>;
}>;

function addRoute(
  routes: Set<string>,
  type: keyof EntityRouteSets,
  identifier: string | null | undefined,
): void {
  const normalized = String(identifier ?? "").trim();
  if (!normalized) return;
  if (routes.has(normalized)) {
    throw new Error(`duplicate ${type} static route identifier: ${normalized}`);
  }
  routes.add(normalized);
}

/**
 * Build the exact identifiers consumed by each detail page's
 * generateStaticParams. Keep this in sync by having those functions call this
 * helper rather than maintaining a second route allowlist.
 */
export function buildEntityRouteSets(catalogs: EntityRouteCatalogs): EntityRouteSets {
  const champion = new Set<string>();
  const augment = new Set<string>();
  const item = new Set<string>();

  for (const row of catalogs.champions) addRoute(champion, "champion", row.slug);
  for (const row of catalogs.augments) addRoute(augment, "augment", row.slug);
  for (const row of catalogs.items.mayhemExclusive) addRoute(item, "item", row.slug);
  for (const row of catalogs.items.items) {
    if (row.id !== null && row.id !== undefined) addRoute(item, "item", String(row.id));
  }

  return { champion, augment, item };
}

export function entityRouteExists(
  routes: EntityRouteSets,
  type: keyof EntityRouteSets,
  routeIdentifier: string,
): boolean {
  return routes[type].has(routeIdentifier);
}

export function localizedEntityHref(
  locale: Locale | string,
  type: keyof EntityRouteSets,
  routeIdentifier: string,
): string {
  const route = `/${type === "champion" ? "champions" : type === "augment" ? "augments" : "items"}/${routeIdentifier}`;
  return locale === "en" ? route : `/${locale}${route}`;
}

/**
 * Validate projected refs against the same route sets used by static params.
 * Keep this as a shared guard so callers cannot silently reintroduce a copied
 * route allowlist or a display-name-derived URL.
 */
export function assertEntityRefRoutes(
  refs: ReadonlyArray<EntityRef>,
  routes: EntityRouteSets,
  locales: ReadonlyArray<Locale | string>,
): void {
  for (const ref of refs) {
    for (const locale of locales) {
      const generatedHref = ref.known && ref.routeIdentifier
        ? localizedEntityHref(locale, ref.type, ref.routeIdentifier)
        : "<none>";
      const expectedBaseHref = ref.known && ref.routeIdentifier
        ? localizedEntityHref("en", ref.type, ref.routeIdentifier)
        : undefined;
      const hasDestination = ref.known
        && Boolean(ref.routeIdentifier)
        && entityRouteExists(routes, ref.type, ref.routeIdentifier);
      if (ref.known && (!hasDestination || ref.href !== expectedBaseHref)) {
        throw new Error(
          `entity route contract: type=${ref.type} canonicalId=${ref.id} `
          + `routeIdentifier=${ref.routeIdentifier || "<none>"} locale=${locale} `
          + `href=${generatedHref}`,
        );
      }
      if (!ref.known && (ref.href || ref.routeIdentifier)) {
        throw new Error(
          `entity route contract: type=${ref.type} canonicalId=${ref.id} `
          + `routeIdentifier=${ref.routeIdentifier || "<none>"} locale=${locale} `
          + `href=${ref.href || "<none>"}`,
        );
      }
    }
  }
}
