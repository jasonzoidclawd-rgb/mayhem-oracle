import { describe, expect, test } from "vitest";
import augmentsData from "../../data/internal/augments.json";
import baseCatalogData from "../../data/internal/augment-base-catalog.json";
import reconciliationReportData from "../../data/internal/augment-reconciliation-report.json";
import winrateFeedData from "../../data/internal/augment-winrate-feed.json";

const VALID_AVAILABILITY_STATUSES = [
  "confirmed_live",
  "candidate_registry_present",
  "disabled",
  "removed",
  "unverified_legacy",
  "conflict",
] as const;

const CDRAGON_REQUIRED_STATUSES = new Set([
  "confirmed_live",
  "candidate_registry_present",
  "disabled",
]);
const NON_LIVE_STATUSES = new Set([
  "candidate_registry_present",
  "disabled",
  "removed",
  "unverified_legacy",
  "conflict",
]);
const OFFERABLE_LIFECYCLE = "active";
const LIVE_SIGNAL_STATUSES = new Set(["live", "observed_live", "observed_bug_mechanism"]);

type AvailabilityStatus = (typeof VALID_AVAILABILITY_STATUSES)[number];
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type AvailabilitySignals = {
  cdragon_registry?: {
    present?: boolean;
    augmentId?: string | null;
    definitionPlaceholder?: boolean;
  };
  wiki?: { status?: string | null };
  tencent?: { status?: string | null };
  telemetry?: { status?: string | null };
  resolution?: { liveSources?: string[] };
};

type Augment = {
  augmentId?: string;
  slug: string;
  name: string;
  rarity: string;
  definitionPlaceholder?: boolean;
  win_rate: number | null;
  flags?: { lifecycle?: string };
  availability?: {
    status?: string;
    signals?: AvailabilitySignals;
  };
  provenance?: JsonValue;
};

type BaseAugment = {
  augmentId: string;
  rarity: string;
};

type ReconciliationReport = {
  availability: {
    byStatus: Record<AvailabilityStatus, number>;
    conflicts: unknown[];
  };
  curatedBreakerReconciliation: Array<{ slug: string; availability: { status: string } }>;
  unverifiedLegacy: {
    count: number;
    augments: Array<{ slug: string }>;
  };
  step7Backlog: {
    knownFailingTests: unknown[];
    workItems: unknown[];
  };
};

type WinrateFeed = {
  win_rates: Record<string, number>;
};

const augments = (augmentsData as { augments: Augment[] }).augments;
const baseCatalog = (baseCatalogData as { augments: BaseAugment[] }).augments;
const reconciliationReport = reconciliationReportData as ReconciliationReport;
const winrateFeed = winrateFeedData as WinrateFeed;

const baseByAugmentId = new Map(baseCatalog.map((augment) => [augment.augmentId, augment]));
const validStatusSet = new Set<string>(VALID_AVAILABILITY_STATUSES);

function collectArammayhemProvenance(
  value: JsonValue | undefined,
  path: string[] = [],
): Array<{ path: string; value: string }> {
  if (typeof value === "string") {
    return value.toLowerCase().includes("arammayhem") ? [{ path: path.join("."), value }] : [];
  }
  if (!value || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectArammayhemProvenance(entry, [...path, String(index)]));
  }

  return Object.entries(value).flatMap(([key, entry]) => collectArammayhemProvenance(entry, [...path, key]));
}

function availabilityCounts(): Record<AvailabilityStatus, number> {
  const counts = Object.fromEntries(VALID_AVAILABILITY_STATUSES.map((status) => [status, 0])) as Record<
    AvailabilityStatus,
    number
  >;

  for (const augment of augments) {
    const status = augment.availability?.status;
    if (validStatusSet.has(status ?? "")) {
      counts[status as AvailabilityStatus] += 1;
    }
  }

  return counts;
}

function hasLiveCorroboration(signals: AvailabilitySignals | undefined): boolean {
  return (
    signals?.wiki?.status === "live" ||
    signals?.tencent?.status === "live" ||
    LIVE_SIGNAL_STATUSES.has(signals?.telemetry?.status ?? "") ||
    (signals?.resolution?.liveSources ?? []).some((source) => source !== "cdragon_registry")
  );
}

describe("augment authority model guards", () => {
  test("keeps arammayhem provenance isolated to win_rate", () => {
    const violations = augments.flatMap((augment) =>
      collectArammayhemProvenance(augment.provenance).flatMap((hit) =>
        hit.path === "win_rate" ? [] : [`${augment.slug}:${hit.path}=${hit.value}`],
      ),
    );

    expect(violations).toEqual([]);
  });

  test("requires CDragon identity and rarity for current registry-backed statuses", () => {
    const violations = augments.flatMap((augment) => {
      const status = augment.availability?.status;
      if (!status || !CDRAGON_REQUIRED_STATUSES.has(status)) {
        return [];
      }

      const base = augment.augmentId ? baseByAugmentId.get(augment.augmentId) : undefined;
      const row = `${augment.slug} (${status})`;
      const failures: string[] = [];

      if (!augment.augmentId) {
        failures.push(`${row} missing augmentId`);
      }
      if (!base) {
        failures.push(`${row} missing CDragon base row for ${augment.augmentId ?? "(none)"}`);
      } else if (augment.rarity !== base.rarity) {
        failures.push(`${row} rarity ${augment.rarity} != CDragon ${base.rarity}`);
      }

      return failures;
    });

    expect(violations).toEqual([]);
  });

  test("never treats registry presence or placeholder definitions as confirmed live", () => {
    const violations = augments.flatMap((augment) => {
      const status = augment.availability?.status;
      const signals = augment.availability?.signals;
      const failures: string[] = [];

      if (status === "confirmed_live") {
        if (signals?.cdragon_registry?.present !== true) {
          failures.push(`${augment.slug} confirmed_live without CDragon registry presence`);
        }
        if (!hasLiveCorroboration(signals)) {
          failures.push(`${augment.slug} confirmed_live without wiki/tencent/telemetry live corroboration`);
        }
      }

      if ((augment.definitionPlaceholder || augment.name === "???") && status === "confirmed_live") {
        failures.push(`${augment.slug} placeholder definition resolved confirmed_live`);
      }

      return failures;
    });

    expect(violations).toEqual([]);
  });

  test("uses only valid availability statuses and keeps non-live rows out of live lifecycles", () => {
    const invalidStatuses = augments.flatMap((augment) => {
      const status = augment.availability?.status;
      return validStatusSet.has(status ?? "") ? [] : [`${augment.slug}:${status ?? "(missing)"}`];
    });
    const lifecycleViolations = augments.flatMap((augment) => {
      const status = augment.availability?.status;
      const placeholder = augment.definitionPlaceholder || augment.name === "???";
      const nonLive = NON_LIVE_STATUSES.has(status ?? "") || placeholder;
      if (status === "confirmed_live" && augment.flags?.lifecycle !== OFFERABLE_LIFECYCLE) {
        return [`${augment.slug}:confirmed_live:${augment.flags?.lifecycle ?? "(missing)"}`];
      }
      if (nonLive && augment.flags?.lifecycle !== "removed") {
        return [`${augment.slug}:${status ?? "(missing)"}:${augment.flags?.lifecycle ?? "(missing)"}`];
      }
      return [];
    });

    expect(invalidStatuses).toEqual([]);
    expect(lifecycleViolations).toEqual([]);
  });

  test("keeps win_rate isolated to the arammayhem feed and allows nulls", () => {
    const violations = augments.flatMap((augment) => {
      const failures: string[] = [];
      const provenance = collectArammayhemProvenance(augment.provenance);

      if (augment.win_rate !== null && typeof augment.win_rate !== "number") {
        failures.push(`${augment.slug} win_rate is not number|null`);
      }
      if (!provenance.some((hit) => hit.path === "win_rate")) {
        failures.push(`${augment.slug} missing arammayhem win_rate provenance`);
      }
      if (augment.augmentId && typeof augment.win_rate === "number" && winrateFeed.win_rates[augment.augmentId] !== augment.win_rate) {
        failures.push(`${augment.slug} win_rate does not match augment-winrate-feed`);
      }

      return failures;
    });

    expect(violations).toEqual([]);
  });

  test("keeps the reconciliation report aligned with committed artifacts", () => {
    const unverifiedLegacySlugs = augments
      .filter((augment) => augment.availability?.status === "unverified_legacy")
      .map((augment) => augment.slug)
      .sort();

    expect(reconciliationReport.availability.byStatus).toEqual(availabilityCounts());
    expect(reconciliationReport.availability.conflicts).toEqual([]);
    expect(reconciliationReport.curatedBreakerReconciliation.map((entry) => entry.slug)).toEqual([
      "jeweled-gauntlet",
      "vulnerability",
      "slow-and-steady",
    ]);
    expect(reconciliationReport.curatedBreakerReconciliation.map((entry) => entry.availability.status)).toEqual([
      "confirmed_live",
      "confirmed_live",
      "candidate_registry_present",
    ]);
    expect(reconciliationReport.unverifiedLegacy.count).toBe(unverifiedLegacySlugs.length);
    expect(reconciliationReport.unverifiedLegacy.augments.map((entry) => entry.slug).sort()).toEqual(
      unverifiedLegacySlugs,
    );
    expect(reconciliationReport.step7Backlog.knownFailingTests).toEqual([]);
    expect(reconciliationReport.step7Backlog.workItems).toEqual([]);
  });
});
