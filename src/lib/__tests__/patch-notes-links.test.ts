import { describe, expect, test } from "vitest";
import augmentsData from "../../../public/data/augments.json";
import championsData from "../../../public/data/champions.json";
import itemsData from "../../../public/data/items.json";
import patchNotesData from "../../../public/data/patch-notes.json";

/**
 * Every chip the patch-notes page links to must resolve to a route that
 * actually exists (champions/[slug], items/[identifier], augments/[slug]).
 * PR #14 shipped 119+ augment links to /augments/<slug> when no detail route
 * existed; this guards against that class of dead link returning.
 */
describe("patch-notes link integrity", () => {
  const championSlugs = new Set(championsData.champions.map((c) => c.slug));
  const augmentSlugs = new Set(augmentsData.augments.map((a) => a.slug));
  const itemIdentifiers = new Set<string>([
    ...itemsData.items
      .filter((i) => i.id != null)
      .map((i) => String(i.id)),
    ...itemsData.mayhemExclusive
      .map((i) => i.slug)
      .filter((s): s is string => Boolean(s)),
  ]);

  interface EntityRef {
    type: string;
    slug: string;
    known?: boolean;
    href?: string;
  }

  const refs: EntityRef[] = [];
  for (const patch of patchNotesData.patches) {
    for (const section of patch.sections) {
      for (const change of section.changes as Array<{
        targets?: EntityRef[];
        relatedEntities?: EntityRef[];
      }>) {
        refs.push(...(change.targets ?? []), ...(change.relatedEntities ?? []));
      }
    }
  }

  test("every linked entity href resolves to a real route", () => {
    const broken: string[] = [];
    for (const ref of refs) {
      if (!ref.href) continue;
      const m = /^\/(champions|items|augments)\/(.+)$/.exec(ref.href);
      if (!m) {
        broken.push(`unexpected href shape: ${ref.href}`);
        continue;
      }
      const [, kind, id] = m;
      const exists =
        kind === "champions"
          ? championSlugs.has(id)
          : kind === "items"
            ? itemIdentifiers.has(id)
            : augmentSlugs.has(id);
      if (!exists) broken.push(`${ref.type} → ${ref.href}`);
    }
    expect(broken, `dead patch-notes links:\n${broken.join("\n")}`).toEqual([]);
  });

  test("known refs carry an href and unknown refs do not link", () => {
    for (const ref of refs) {
      if (ref.known === false) {
        expect(ref.href, `unknown ${ref.type} should not link`).toBeUndefined();
      }
    }
  });

  test("removed augments in the archive all resolve to the augment route", () => {
    const removed = augmentsData.augments.filter(
      (a) => (a.flags as { lifecycle?: string } | undefined)?.lifecycle === "removed",
    );
    for (const augment of removed) {
      expect(augmentSlugs.has(augment.slug)).toBe(true);
    }
  });
});
