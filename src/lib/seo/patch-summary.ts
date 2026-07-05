type PatchSummaryInput = {
  entityName: string;
  entityKind: string;
  patch?: string | null;
  lifecycleState?: string | null;
  lifecyclePatch?: string | null;
  publicChanges?: string[];
};

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

  if (lifecycleState && lifecycleState !== "active") {
    lines.push(
      lifecyclePatch
        ? `${entityName} is marked ${lifecycleState} in patch ${lifecyclePatch}.`
        : `${entityName} is marked ${lifecycleState}.`,
    );
  }

  for (const change of input.publicChanges ?? []) {
    const publicChange = clean(change);
    if (publicChange) lines.push(publicChange);
  }

  return {
    title: "Patch summary",
    lines,
  };
}
