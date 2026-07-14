"use client";

import Image from "next/image";
import { useState } from "react";
import type { AugmentQualityTier, EntityRef } from "@/lib/entities/types";
import { ENTITY_ICON_SIZES, type EntityIconVariant } from "./entity-icon-constants";

export type EntityIconFrame = "neutral" | "quality-tier";

function fallbackGlyph(type: EntityRef["type"]): string {
  return type === "champion" ? "C" : type === "augment" ? "A" : "I";
}

/**
 * Render a fixed-size entity icon with a visible fallback during lazy loading
 * and after a remote asset error. The fallback occupies the same box as the
 * image, so a slow/invalid CDN response cannot create a blank icon or layout
 * shift. The parent EntityLink supplies the accessible name.
 */
export function EntityIcon({
  entity,
  variant = "standard",
  loading = "lazy",
  frame = "neutral",
  qualityTier,
  rarity,
}: {
  entity: EntityRef;
  variant?: EntityIconVariant;
  loading?: "lazy" | "eager";
  frame?: EntityIconFrame;
  qualityTier?: AugmentQualityTier | null;
  rarity?: string;
}) {
  const size = ENTITY_ICON_SIZES[variant] ?? ENTITY_ICON_SIZES.standard;
  const usesQualityTier = entity.type === "augment" && frame === "quality-tier";
  const normalizedTier = usesQualityTier ? (qualityTier ?? "neutral") : undefined;
  const [state, setState] = useState<"loading" | "loaded" | "error">(
    entity.iconUrl ? "loading" : "error",
  );
  const showFallback = state !== "loaded";

  return (
    <span
      aria-hidden="true"
      data-entity-icon="true"
      data-entity-type={entity.type}
      data-entity-icon-state={state}
      {...(normalizedTier ? { "data-tier": normalizedTier } : {})}
      data-rarity={rarity ?? ""}
      className={`${size.image} relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] text-[10px] font-bold text-[var(--color-text-muted)]`}
    >
      <span className={showFallback ? "" : "sr-only"}>{fallbackGlyph(entity.type)}</span>
      {entity.iconUrl && state !== "error" ? (
        <Image
          src={entity.iconUrl}
          alt=""
          aria-hidden="true"
          width={size.pixels}
          height={size.pixels}
          className="absolute inset-0 h-full w-full rounded object-contain"
          sizes={size.sizes}
          loading={loading}
          unoptimized
          onLoad={() => setState("loaded")}
          onError={() => setState("error")}
        />
      ) : null}
    </span>
  );
}
