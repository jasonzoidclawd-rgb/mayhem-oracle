"use client";

import { shouldLoadAds } from "@/lib/ads/consent";
import { useAdConsent } from "@/lib/ads/useAdConsent";
import { useEffect, useRef } from "react";

const ADS_ENABLED = process.env.NEXT_PUBLIC_ADS_ENABLED;
const AD_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/**
 * A single AdSense unit for PUBLIC reference pages only. Never rendered on
 * Advisor, account, admin, auth, or member surfaces. The ad script loads
 * lazily and ONLY after consent — never on first paint. A fixed min-height is
 * always reserved so enabling ads later causes no layout shift.
 */
export function AdSlot({ slot, minHeight = 100 }: { slot: string; minHeight?: number }) {
  const consent = useAdConsent();
  const pushed = useRef(false);
  const active = shouldLoadAds(ADS_ENABLED, consent) && Boolean(AD_CLIENT);

  useEffect(() => {
    if (!active || pushed.current) return;
    pushed.current = true;
    const scriptId = "adsbygoogle-js";
    if (!document.getElementById(scriptId)) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${AD_CLIENT}`;
      document.head.appendChild(script);
    }
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // AdSense not ready yet; the script's own queue will flush.
    }
  }, [active]);

  // Reserve space regardless so the slot never shifts layout.
  return (
    <div style={{ minHeight }} aria-hidden={!active} className="my-4 w-full overflow-hidden">
      {active ? (
        <ins
          className="adsbygoogle"
          style={{ display: "block" }}
          data-ad-client={AD_CLIENT}
          data-ad-slot={slot}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      ) : null}
    </div>
  );
}
