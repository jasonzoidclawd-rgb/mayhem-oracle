import Image from "next/image";
import { Link } from "@/i18n/navigation";
import type { EntityRef } from "@/lib/entities/types";

const SIZE = {
  compact: { image: "h-5 w-5", text: "text-xs", gap: "gap-1.5", sizes: "20px" },
  standard: { image: "h-7 w-7", text: "text-sm", gap: "gap-2", sizes: "28px" },
  hero: { image: "h-14 w-14 sm:h-20 sm:w-20", text: "text-xl sm:text-3xl", gap: "gap-3 sm:gap-5", sizes: "80px" },
} as const;

function fallbackGlyph(type: EntityRef["type"]): string {
  return type === "champion" ? "C" : type === "augment" ? "A" : "I";
}

export function EntityIcon({ entity, variant = "standard" }: { entity: EntityRef; variant?: keyof typeof SIZE }) {
  const size = SIZE[variant];
  if (entity.icon) {
    return (
      <Image
        src={entity.icon}
        alt=""
        aria-hidden="true"
        width={variant === "compact" ? 20 : variant === "hero" ? 80 : 28}
        height={variant === "compact" ? 20 : variant === "hero" ? 80 : 28}
        className={`${size.image} shrink-0 rounded object-contain`}
        sizes={size.sizes}
        unoptimized
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`${size.image} flex shrink-0 items-center justify-center rounded border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] text-[10px] font-bold text-[var(--color-text-muted)]`}
    >
      {fallbackGlyph(entity.type)}
    </span>
  );
}

export function EntityLink({
  entity,
  variant = "standard",
  className = "",
}: {
  entity: EntityRef;
  variant?: keyof typeof SIZE;
  className?: string;
}) {
  const size = SIZE[variant];
  return (
    <Link
      href={entity.href}
      aria-label={`${entity.name} (${entity.type})`}
      data-entity-type={entity.type}
      data-entity-id={entity.canonicalId}
      className={`inline-flex min-w-0 items-center ${size.gap} rounded ${size.text} text-[var(--color-text-primary)] underline-offset-2 transition-colors hover:text-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${className}`}
    >
      <EntityIcon entity={entity} variant={variant} />
      <span className="min-w-0 truncate">{entity.name}</span>
    </Link>
  );
}
