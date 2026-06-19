"use client";

import { useSyncExternalStore } from "react";
import { CONSENT_STORAGE_KEY, parseStoredConsent, type AdConsent } from "./consent";

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener("mayhem-ads-consent", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("mayhem-ads-consent", callback);
  };
}

function getSnapshot(): string | null {
  return localStorage.getItem(CONSENT_STORAGE_KEY);
}

// SSR / first paint: consent is unknown, so nothing ad-related renders.
function getServerSnapshot(): string | null {
  return null;
}

/** Reactive consent state, updating when another component records a choice. */
export function useAdConsent(): AdConsent {
  return parseStoredConsent(useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot));
}

export function recordConsent(value: Exclude<AdConsent, null>): void {
  localStorage.setItem(CONSENT_STORAGE_KEY, value);
  window.dispatchEvent(new Event("mayhem-ads-consent"));
}
