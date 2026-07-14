import { Link } from "@/i18n/navigation";
import type { AugmentQualityTier, EntityRef } from "@/lib/entities/types";
import { EntityIcon, type EntityIconFrame } from "./EntityIcon";
import { ENTITY_ICON_SIZES, type EntityIconVariant } from "./entity-icon-constants";

const SIZE = ENTITY_ICON_SIZES;

export function EntityLink({
  entity,
  variant = "standard",
  className = "",
  loading = "lazy",
  frame,
  qualityTier,
  rarity,
}: {
  entity: EntityRef;
  variant?: EntityIconVariant;
  className?: string;
  loading?: "lazy" | "eager";
  frame?: EntityIconFrame;
  qualityTier?: AugmentQualityTier | null;
  rarity?: string;
}) {
  // Keep the server render fail-closed if an older caller passes an unknown
  // variant during static generation; the contract's standard presentation is
  // the safe fixed-size fallback.
  const size = SIZE[variant] ?? SIZE.standard;
  const resolvedFrame: EntityIconFrame = entity.type === "augment" ? (frame ?? "quality-tier") : "neutral";
  const resolvedQualityTier = entity.type === "augment" && resolvedFrame === "quality-tier" ? qualityTier ?? entity.qualityTier ?? null : null;
  const classes = `inline-flex min-w-0 items-center ${size.gap} rounded ${size.text} text-[var(--color-text-primary)] ${
    entity.known && entity.href ? "underline-offset-2 transition-colors hover:text-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]" : ""
  } ${className}`;
  const content = (
    <>
      <EntityIcon
        entity={entity}
        variant={variant}
        loading={loading}
        frame={resolvedFrame}
        qualityTier={resolvedQualityTier}
        rarity={rarity}
      />
      <span className="min-w-0 truncate">{entity.localizedName}</span>
    </>
  );
  const label = `${entity.localizedName} (${entity.type})${rarity ? `, ${rarity}` : ""}`;
  if (!entity.known || !entity.href) {
    return (
      <span
        aria-label={label}
        data-entity-type={entity.type}
        data-entity-id={entity.id}
        className={classes}
      >
        {content}
      </span>
    );
  }
  return (
    <Link
      href={entity.href}
      aria-label={label}
      data-entity-type={entity.type}
      data-entity-id={entity.id}
      className={classes}
    >
      {content}
    </Link>
  );
}
