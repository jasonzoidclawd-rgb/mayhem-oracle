/**
 * OCR-triggering policy (identity track).
 *
 * OCR is expensive and must NOT run every geometry tick. Given the live geometry
 * observation and the current per-slot identity records, this decides exactly
 * which slots need a (re)read:
 *
 *   - a present slot with NO identity record yet (a freshly appeared offer);
 *   - a present slot whose fingerprint CHANGED vs its stored identity (a reroll —
 *     only that slot re-reads; untouched slots keep their identities);
 *   - a present slot still UNRESOLVED past the retry deadline (OCR missed it);
 *   - any slot named in `forceSlots` (dev force-refresh).
 *
 * When the surface is absent or occluded there is nothing to identify — no OCR.
 * All rules are pure so the policy is unit-tested without IPC or timers.
 */
import {
  fingerprintChanged,
  type GeometryObservation,
  type IdentityRecord,
} from "./surfaceGeometry";

export interface OcrTriggerInput<R> {
  observation: GeometryObservation;
  /** Current identity record per region (index 0..2), null when never resolved. */
  identities: Array<IdentityRecord<R> | null>;
  now: number;
  retryMs: number;
  /** Regions to force a re-read regardless of state (dev force-refresh). */
  forceSlots?: number[];
}

export interface OcrTriggerDecision {
  trigger: boolean;
  /** Region indices that need OCR this cycle (empty when trigger is false). */
  slots: number[];
  reason: string;
}

export function decideOcrTrigger<R>(input: OcrTriggerInput<R>): OcrTriggerDecision {
  const { observation, identities, now, retryMs } = input;
  const force = new Set(input.forceSlots ?? []);
  if (!observation.present || observation.occluded) {
    return { trigger: false, slots: [], reason: observation.occluded ? "occluded" : "absent" };
  }

  const slots: number[] = [];
  const reasons: string[] = [];
  for (const card of observation.cards) {
    if (!card.present) continue;
    const i = card.regionIndex;
    if (force.has(i)) {
      slots.push(i);
      reasons.push(`force:${i}`);
      continue;
    }
    const record = identities[i] ?? null;
    if (record == null) {
      slots.push(i);
      reasons.push(`new:${i}`);
      continue;
    }
    if (fingerprintChanged(record.fingerprint, card.fingerprint)) {
      slots.push(i);
      reasons.push(`reroll:${i}`);
      continue;
    }
    const retryAt = record.retryAt ?? (record.resolvedAt + retryMs);
    if (record.resolution == null && now >= retryAt) {
      slots.push(i);
      reasons.push(`retry:${i}`);
    }
  }

  return {
    trigger: slots.length > 0,
    slots,
    reason: slots.length > 0 ? reasons.join(",") : "up-to-date",
  };
}
