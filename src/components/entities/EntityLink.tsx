import { Link } from "@/i18n/navigation";
import type { EntityRef } from "@/lib/entities/types";
import { EntityIcon } from "./EntityIcon";
import { ENTITY_ICON_SIZES, type EntityIconVariant } from "./entity-icon-constants";

const SIZE = ENTITY_ICON_SIZES;

export function EntityLink({
  entity,
  variant = "standard",
  className = "",
  loading = "lazy",
}: {
  entity: EntityRef;
  variant?: EntityIconVariant;
  className?: string;
  loading?: "lazy" | "eager";
}) {
  // Keep the server render fail-closed if an older caller passes an unknown
  // variant during static generation; the contract's standard presentation is
  // the safe fixed-size fallback.
  const size = SIZE[variant] ?? SIZE.standard;
  const classes = `inline-flex min-w-0 items-center ${size.gap} rounded ${size.text} text-[var(--color-text-primary)] ${
    entity.known && entity.href ? "underline-offset-2 transition-colors hover:text-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]" : ""
  } ${className}`;
  const content = (
    <>
      <EntityIcon entity={entity} variant={variant} loading={loading} />
      <span className="min-w-0 truncate">{entity.localizedName}</span>
    </>
  );
  const label = `${entity.localizedName} (${entity.type})`;
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
