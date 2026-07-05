type PatchSummaryInput = {
  entityName: string;
  entityKind: string;
  patch?: string | null;
  lifecycleState?: string | null;
  lifecyclePatch?: string | null;
};

// Lifecycle is scraper-owned; only allowlisted states may surface in public
// copy so future states never ship unreviewed wording.
const PUBLIC_LIFECYCLE_STATES = new Set(["removed"]);

type PatchSummary = {
  title: string;
  lines: string[];
};

function clean(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function buildPatchSummary(input: PatchSummaryInput): PatchSummary {
  const entityName = clean(input.entityName) ?? "This page";
  const entityKind = clean(input.entityKind) ?? "entry";
  const patch = clean(input.patch);
  const lifecycleState = clean(input.lifecycleState);
  const lifecyclePatch = clean(input.lifecyclePatch) ?? patch;
  const lines = [
    patch
      ? `This ${entityKind} page for ${entityName} reflects public Arena Mayhem data for patch ${patch}.`
      : `This ${entityKind} page for ${entityName} reflects public Arena Mayhem data.`,
  ];

  if (lifecycleState && PUBLIC_LIFECYCLE_STATES.has(lifecycleState)) {
    lines.push(
      lifecyclePatch
        ? `${entityName} is marked ${lifecycleState} in patch ${lifecyclePatch}.`
        : `${entityName} is marked ${lifecycleState}.`,
    );
  }

  return {
    title: "Patch summary",
    lines,
  };
}
