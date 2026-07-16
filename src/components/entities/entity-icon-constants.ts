export const ENTITY_ICON_SIZES = {
  compact: { image: "h-5 w-5", text: "text-xs", gap: "gap-1.5", sizes: "20px", pixels: 20 },
  standard: { image: "h-7 w-7", text: "text-sm", gap: "gap-2", sizes: "28px", pixels: 28 },
  hero: { image: "h-14 w-14 sm:h-20 sm:w-20", text: "text-xl sm:text-3xl", gap: "gap-3 sm:gap-5", sizes: "80px", pixels: 80 },
} as const;

export type EntityIconVariant = keyof typeof ENTITY_ICON_SIZES;
