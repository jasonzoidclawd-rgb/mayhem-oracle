"use client";

import { CONSENT_STORAGE_KEY, parseStoredConsent } from "@/lib/ads/consent";

export const ANALYTICS_EVENTS = [
  "page_view",
  "entity_search",
  "champion_open",
  "augment_open",
  "overlay_cta_click",
  "signup_start",
  "signup_complete",
  "ad_slot_viewable",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];
type AnalyticsProperties = Record<string, string | number>;
type AnalyticsSender = (event: AnalyticsEvent, properties?: AnalyticsProperties) => void;

type PlausibleOptions = {
  props?: AnalyticsProperties;
};

type PlausibleFunction = ((event: string, options?: PlausibleOptions) => void) & {
  q?: unknown[];
};

declare global {
  interface Window {
    plausible?: PlausibleFunction;
  }
}

const PLAUSIBLE_SCRIPT_ID = "plausible-analytics-script";
const PLAUSIBLE_SCRIPT_SRC = "https://plausible.io/js/script.manual.js";
const PLAUSIBLE_DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN || "wasfun.lol";

let senderOverride: AnalyticsSender | null = null;

function hasGrantedConsent(): boolean {
  if (typeof window === "undefined") return false;

  try {
    return parseStoredConsent(window.localStorage.getItem(CONSENT_STORAGE_KEY)) === "granted";
  } catch {
    return false;
  }
}

function normalizeProperties(
  event: AnalyticsEvent,
  properties: Record<string, unknown> | undefined,
): AnalyticsProperties | undefined {
  if (!properties) return undefined;

  if (event === "entity_search") {
    const resultCount = properties.result_count;
    return typeof resultCount === "number" && Number.isFinite(resultCount)
      ? { result_count: Math.max(0, Math.floor(resultCount)) }
      : undefined;
  }

  if (event === "champion_open" || event === "augment_open") {
    const slug = properties.slug;
    return typeof slug === "string" && /^[a-z0-9][a-z0-9-]*$/.test(slug)
      ? { slug }
      : undefined;
  }

  if (event === "ad_slot_viewable") {
    const slot = properties.slot;
    return typeof slot === "string" && /^[a-zA-Z0-9_-]+$/.test(slot) ? { slot } : undefined;
  }

  // page_view and CTA/auth events carry no custom properties. Plausible still
  // receives the current route as its event URL without receiving form data,
  // query text, or any other user-controlled value from this wrapper.
  return undefined;
}

function ensurePlausibleLoaded(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  if (!window.plausible) {
    const queued = ((event: string, options?: PlausibleOptions) => {
      queued.q = queued.q || [];
      queued.q.push([event, options]);
    }) as PlausibleFunction;
    queued.q = [];
    window.plausible = queued;
  }

  if (document.getElementById(PLAUSIBLE_SCRIPT_ID)) return;

  const script = document.createElement("script");
  script.id = PLAUSIBLE_SCRIPT_ID;
  script.defer = true;
  script.dataset.domain = PLAUSIBLE_DOMAIN;
  script.src = PLAUSIBLE_SCRIPT_SRC;
  document.head.appendChild(script);
}

/** Load the manual Plausible script only after the existing consent decision. */
export function enableAnalytics(): boolean {
  if (!hasGrantedConsent()) return false;
  ensurePlausibleLoaded();
  return true;
}

/** Send one of the eight allowlisted events, gated by the existing consent key. */
export function track(event: AnalyticsEvent, properties?: Record<string, unknown>): boolean {
  if (!hasGrantedConsent()) return false;

  const normalizedProperties = normalizeProperties(event, properties);
  if (senderOverride) {
    if (normalizedProperties) senderOverride(event, normalizedProperties);
    else senderOverride(event);
    return true;
  }

  ensurePlausibleLoaded();
  if (!window.plausible) return false;
  window.plausible(
    event,
    normalizedProperties ? { props: normalizedProperties } : undefined,
  );
  return true;
}

/** Test-only dependency injection; production code never calls this. */
export function setAnalyticsSenderForTests(sender: AnalyticsSender): void {
  senderOverride = sender;
}

/** Test-only cleanup for the consent-gating unit tests. */
export function resetAnalyticsSenderForTests(): void {
  senderOverride = null;
}
