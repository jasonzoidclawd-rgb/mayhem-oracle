import type {
  AugmentRarity,
  AugmentRound,
  DecisionContext,
  DecisionMode,
} from "../contracts/decision";

const MODES: readonly DecisionMode[] = ["competitive", "exploration"];
const RARITIES: readonly AugmentRarity[] = ["silver", "gold", "prismatic"];
const ROUNDS: readonly AugmentRound[] = [1, 2, 3, 4];

export type ContextParse =
  | { ok: true; context: DecisionContext }
  | { ok: false; error: string };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * Strict parse of an untrusted request body into a DecisionContext.
 * Unknown fields are dropped; nothing flows through untyped.
 */
export function parseDecisionContext(body: unknown): ContextParse {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.championSlug !== "string" || b.championSlug.length === 0) {
    return { ok: false, error: "championSlug is required" };
  }
  if (!ROUNDS.includes(b.round as AugmentRound)) {
    return { ok: false, error: "round must be 1-4" };
  }
  if (!RARITIES.includes(b.screenRarity as AugmentRarity)) {
    return { ok: false, error: "screenRarity must be silver|gold|prismatic" };
  }
  if (!MODES.includes(b.mode as DecisionMode)) {
    return { ok: false, error: "mode must be competitive|exploration" };
  }
  for (const field of ["ownedAugmentSlugs", "currentItemIds", "plannedItemIds"] as const) {
    if (!isStringArray(b[field])) {
      return { ok: false, error: `${field} must be an array of strings` };
    }
  }
  for (const field of ["offeredAugmentSlugs", "seenOfferSlugs"] as const) {
    if (b[field] !== undefined) {
      if (!isStringArray(b[field]) || (b[field] as string[]).length === 0 || (b[field] as string[]).length > 6) {
        return { ok: false, error: `${field} must be 1-6 slugs when present` };
      }
    }
  }
  if (
    typeof b.rerollsRemaining !== "number" ||
    !Number.isInteger(b.rerollsRemaining) ||
    b.rerollsRemaining < 0 ||
    b.rerollsRemaining > 10
  ) {
    return { ok: false, error: "rerollsRemaining must be an integer 0-10" };
  }
  if (typeof b.goldenRerollAvailable !== "boolean") {
    return { ok: false, error: "goldenRerollAvailable must be a boolean" };
  }

  return {
    ok: true,
    context: {
      championSlug: b.championSlug,
      round: b.round as AugmentRound,
      screenRarity: b.screenRarity as AugmentRarity,
      mode: b.mode as DecisionMode,
      ownedAugmentSlugs: b.ownedAugmentSlugs as string[],
      currentItemIds: b.currentItemIds as string[],
      plannedItemIds: b.plannedItemIds as string[],
      ...(b.offeredAugmentSlugs !== undefined
        ? { offeredAugmentSlugs: b.offeredAugmentSlugs as string[] }
        : {}),
      ...(b.seenOfferSlugs !== undefined
        ? { seenOfferSlugs: b.seenOfferSlugs as string[] }
        : {}),
      rerollsRemaining: b.rerollsRemaining,
      goldenRerollAvailable: b.goldenRerollAvailable,
    },
  };
}
