type PatchSummaryInput = {
  patch?: string | null;
  lifecycleState?: string | null;
  lifecyclePatch?: string | null;
};

/**
 * Pre-localized copy from the route's message namespace. The helper decides
 * WHICH bounded lines may render; it never produces user-facing strings
 * itself, so all copy stays in messages/*.json.
 */
type PatchSummaryCopy = {
  title: string;
  body: (values: { patch: string }) => string;
  /** Omit for entity kinds without public lifecycle flags (e.g. items). */
  removed?: (values: { patch: string }) => string;
};

type PatchSummary = {
  title: string;
  lines: string[];
};

// Lifecycle is scraper-owned; only allowlisted states may surface in public
// copy so future states never ship unreviewed wording.
const PUBLIC_LIFECYCLE_STATES = new Set(["removed"]);

function clean(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Returns null when no public patch value exists: freshness claims must trace
 * to published data, so without a patch the summary block is omitted entirely.
 */
export function buildPatchSummary(
  input: PatchSummaryInput,
  copy: PatchSummaryCopy,
): PatchSummary | null {
  const patch = clean(input.patch);
  if (!patch) return null;

  const lines = [copy.body({ patch })];

  const lifecycleState = clean(input.lifecycleState);
  if (lifecycleState && PUBLIC_LIFECYCLE_STATES.has(lifecycleState) && copy.removed) {
    lines.push(copy.removed({ patch: clean(input.lifecyclePatch) ?? patch }));
  }

  return {
    title: copy.title,
    lines,
  };
}
