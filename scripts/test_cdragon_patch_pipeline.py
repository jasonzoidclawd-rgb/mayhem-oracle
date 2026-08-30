#!/usr/bin/env python3
"""Fixture tests for two-lane CDragon promotion and failure behavior."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from cdragon_patch_pipeline import (
    _latest_patch_label,
    build_branch_update,
    fetch_branch_entities,
    promote_branch,
    read_snapshot_lineage,
)
from cdragon_snapshot_diff import build_snapshot, snapshot_filename


def entity(entity_id: str, slug: str, **fields: object) -> dict:
    return {"id": entity_id, "slug": slug, "names": {"en": slug}, "fields": fields}


def snapshot(entity_type: str, branch: str, version: str, rows: list[dict]) -> dict:
    return build_snapshot(
        entity_type=entity_type,
        branch=branch,
        source_version=version,
        source_patch_label=("26.13" if branch == "latest" else f"pbe-cycle-{version}"),
        observed_at="2026-07-11T00:00:00Z",
        entities=rows,
    )


def entities(version_delta: int = 0) -> dict[str, list[dict]]:
    return {
        "augment": [entity("A", "augment", rarity="gold")],
        "champion": [entity("63", "brand", abilities={"Q": {"cooldown": [8 - version_delta]}})],
        "item": [entity("1001", "boots", cost=300 + version_delta * 50)],
    }


def variant_roster_fetch():
    """Fake CDragon `latest` serving one prime champion and one variant of it.

    Mirrors the live roster shape observed at 16.17: the variant row appears in
    champion-summary and has a champion detail, but that detail carries a prime
    back-reference and `game/data/characters/<key>` returns 404 for it.
    """
    prime = {"id": 63, "name": "Brand", "alias": "Brand", "roles": ["mage"]}
    variant = {"id": 60063, "name": "Brand", "alias": "Jade_Brand", "roles": ["mage"]}
    details = {
        "63": {"id": 63, "name": "Brand", "alias": "Brand", "spells": []},
        "60063": {
            "id": 60063,
            "name": "Brand",
            "alias": "Jade_Brand",
            "spells": [],
            "relatedPrimeContentId": "0b95894e-0df2-470e-b282-6c5f5cf41955",
            "relatedPrimeItemId": 63,
        },
    }
    bin_payload = {
        "Characters/Brand": {
            "__type": "CharacterRecord",
            "baseHPModifiable": {"baseValue": 590.0},
            "baseDamageModifiable": {"baseValue": 57.0},
        }
    }

    def fetch(url: str):
        if url.endswith("/content-metadata.json"):
            return {"version": "16.17.1"}
        if url.endswith("/cherry-augments.json"):
            return []
        if url.endswith("/lol.stringtable.json"):
            return {"entries": {}}
        if url.endswith("/champion-summary.json"):
            return [prime, variant]
        if url.endswith("/items.json"):
            return []
        if "/champions/" in url:
            return details[url.rsplit("/", 1)[1][: -len(".json")]]
        if "/game/data/characters/" in url:
            key = url.rsplit("/", 1)[1][: -len(".bin.json")]
            if key == "brand":
                return bin_payload
            raise OSError(f"HTTP Error 404: Not Found: {url}")
        raise AssertionError(f"unexpected url {url}")

    return fetch


class CDragonPatchPipelineTests(unittest.TestCase):
    def test_independent_latest_and_pbe_lineages_keep_provenance_isolated(self):
        latest = build_branch_update(
            branch="latest",
            source_version="16.13.2",
            source_patch_label="26.13",
            observed_at="2026-07-11T01:00:00Z",
            entities_by_type=entities(0),
            previous_snapshots={},
            latest_snapshots={},
            previous_archive=None,
        )
        pbe = build_branch_update(
            branch="pbe",
            source_version="16.14.1",
            source_patch_label="pbe-cycle-16.14.1",
            observed_at="2026-07-11T01:00:00Z",
            entities_by_type=entities(1),
            previous_snapshots={},
            latest_snapshots=latest["snapshots"],
            previous_archive=None,
        )

        self.assertEqual(set(latest["snapshots"]), {"augment", "champion", "item"})
        self.assertEqual(set(pbe["snapshots"]), {"augment", "champion", "item"})
        self.assertTrue(all(row["branch"] == "latest" for row in latest["snapshots"].values()))
        self.assertTrue(all(row["branch"] == "pbe" for row in pbe["snapshots"].values()))
        self.assertEqual(pbe["archive"]["branch"], "pbe")
        self.assertEqual(pbe["archive"]["status"], "fresh")
        self.assertTrue(all(event["branch"] == "pbe" for event in pbe["archive"]["events"]))
        self.assertTrue(all(event["comparison"]["base_branch"] == "latest" for event in pbe["archive"]["events"]))

    def test_live_hotfix_and_preview_to_live_landing_are_not_duplicated(self):
        latest_old = {kind: snapshot(kind, "latest", "16.13.1", rows) for kind, rows in entities(0).items()}
        latest_new = build_branch_update(
            branch="latest",
            source_version="16.13.2",
            source_patch_label="26.13",
            observed_at="2026-07-11T02:00:00Z",
            entities_by_type=entities(1),
            previous_snapshots=latest_old,
            latest_snapshots={},
            previous_archive=None,
        )
        self.assertTrue(any(event["is_hotfix"] for event in latest_new["archive"]["events"]))

        pbe_old = {kind: snapshot(kind, "pbe", "16.14.1", rows) for kind, rows in entities(0).items()}
        pbe = build_branch_update(
            branch="pbe",
            source_version="16.14.2",
            source_patch_label="pbe-cycle-16.14.2",
            observed_at="2026-07-11T01:00:00Z",
            entities_by_type=entities(1),
            previous_snapshots=pbe_old,
            latest_snapshots=latest_old,
            previous_archive=None,
        )
        landed = build_branch_update(
            branch="pbe",
            source_version="16.14.2",
            source_patch_label="pbe-cycle-16.14.2",
            observed_at="2026-07-12T01:00:00Z",
            entities_by_type=entities(1),
            previous_snapshots=pbe["snapshots"],
            latest_snapshots=latest_new["snapshots"],
            previous_archive=pbe["archive"],
        )

        self.assertEqual(len(landed["archive"]["events"]), len(pbe["archive"]["events"]))
        self.assertTrue(all(event["landed"] for event in landed["archive"]["events"]))

    def test_pbe_version_regression_starts_a_fresh_lineage_without_removals(self):
        previous = {kind: snapshot(kind, "pbe", "16.14.9", rows) for kind, rows in entities(1).items()}
        prior_archive = {
            "schema_version": 1,
            "branch": "pbe",
            "lane": "preview",
            "events": [{"entity_type": "item", "slug": "old", "lifecycle": "upcoming", "landed": False}],
        }
        update = build_branch_update(
            branch="pbe",
            source_version="16.14.1",
            source_patch_label="pbe-cycle-16.14.1",
            observed_at="2026-07-11T01:00:00Z",
            entities_by_type=entities(0),
            previous_snapshots=previous,
            latest_snapshots={},
            previous_archive=prior_archive,
        )

        self.assertTrue(update["reset"])
        self.assertEqual(update["new_events"], [])
        self.assertEqual(update["archive"]["events"][0]["lifecycle"], "aged_out")

    def test_current_pbe_without_a_latest_baseline_is_not_mislabeled_as_no_changes(self):
        update = build_branch_update(
            branch="pbe",
            source_version="16.14.1",
            source_patch_label="pbe-cycle-16.14.1",
            observed_at="2026-07-11T01:00:00Z",
            entities_by_type=entities(1),
            previous_snapshots={},
            latest_snapshots={},
            previous_archive=None,
        )

        self.assertEqual(update["archive"]["status"], "not_yet_confirmed")
        self.assertEqual(update["archive"]["events"], [])

    def test_stale_latest_baseline_keeps_pbe_unconfirmed(self):
        latest = build_branch_update(
            branch="latest",
            source_version="16.13.2",
            source_patch_label="26.13",
            observed_at="2026-07-11T01:00:00Z",
            entities_by_type=entities(0),
            previous_snapshots={},
            latest_snapshots={},
            previous_archive=None,
        )
        pbe = build_branch_update(
            branch="pbe",
            source_version="16.14.1",
            source_patch_label="pbe-cycle-16.14.1",
            observed_at="2026-07-11T02:00:00Z",
            entities_by_type=entities(1),
            previous_snapshots={},
            latest_snapshots=latest["snapshots"],
            previous_archive=None,
            latest_baseline_confirmed=False,
        )

        self.assertEqual(pbe["archive"]["status"], "not_yet_confirmed")
        self.assertEqual(pbe["archive"]["events"], [])

    def test_lineage_reader_rejects_malformed_snapshot_without_falling_back_to_another_lane(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            internal = Path(tmpdir)
            (internal / snapshot_filename("item", "pbe")).write_text("{bad", encoding="utf-8")
            (internal / snapshot_filename("item", "latest")).write_text(
                json.dumps(snapshot("item", "latest", "16.13.1", [entity("1", "boots")])),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "malformed"):
                read_snapshot_lineage(internal, "pbe")

    def test_failed_pbe_acquisition_does_not_promote_or_mutate_live_lineage(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            internal = Path(tmpdir)
            latest = snapshot("item", "latest", "16.13.1", [entity("1", "boots")])
            latest_path = internal / snapshot_filename("item", "latest")
            latest_path.write_text(json.dumps(latest), encoding="utf-8")
            before = latest_path.read_bytes()

            def unavailable(_url: str):
                raise OSError("fixture PBE source unavailable")

            with self.assertRaisesRegex(OSError, "source unavailable"):
                promote_branch("pbe", internal_dir=internal, fetch_json=unavailable)

            self.assertEqual(latest_path.read_bytes(), before)
            self.assertFalse((internal / snapshot_filename("item", "pbe")).exists())


    def test_variant_champion_rows_without_a_character_bin_do_not_abort_acquisition(self):
        """CDragon's alternate-mode roster has prime back-references and no bin.

        Live `latest` at 16.17 serves 63 such rows (aliased `Jade_*`, ids 60001+)
        beside the 173 real champions.  They are variants of a prime champion,
        not champions, and have no `game/data/characters/<key>` bin.  Treating
        them as champions aborts the whole acquisition on a 404.
        """
        source_version, entities_by_type, _sources = fetch_branch_entities(
            "latest", fetch_json=variant_roster_fetch()
        )

        self.assertEqual(source_version, "16.17.1")
        ids = [str(row["id"]) for row in entities_by_type["champion"]]
        self.assertEqual(ids, ["63"])


class DisplayPatchAuthorityTests(unittest.TestCase):
    """BUG-3: a Riot CDragon build must not be labelled with a third party's patch.

    `data/internal/meta.json` `.patch` is written by `scrape_arammayhem.py` from
    arammayhem.com. It correctly means "the patch the win-rate feed describes",
    and that third party lags Riot. It is NOT "the display patch of the CDragon
    build we just acquired".

    Observed live on 2026-08-29 after a clean pipeline run: CDragon served
    16.17.x (= 26.17) while meta.json said 26.16, so we published 26.17
    mechanics stamped 26.16 -- and the nightly telemetry loader would quarantine
    every real 16.17 match as invalid_patch.

    Riot's own display authority was already on disk and unused:
    `patch-metadata.json` `.patches[0].version`, written at step 11, before
    CDragon acquisition at step 12.
    """

    def _internal_dir(self, tmp: str, *, riot_display: str | None, third_party: str) -> Path:
        internal = Path(tmp)
        # The third-party statistical feed patch (arammayhem), lagging on purpose.
        (internal / "meta.json").write_text(
            json.dumps({"patch": third_party, "source": "https://arammayhem.com"}),
            encoding="utf-8",
        )
        if riot_display is not None:
            # Riot-owned display authority, as scrape_patch_notes.py writes it.
            (internal / "patch-metadata.json").write_text(
                json.dumps({
                    "patch": riot_display,
                    "patches": [{"version": riot_display}, {"version": "26.16"}],
                }),
                encoding="utf-8",
            )
        return internal

    def test_current_mechanics_take_riots_display_patch_not_the_feeds(self):
        """The seam: Riot says 26.17, arammayhem says 26.16, build is 16.17.x."""
        with tempfile.TemporaryDirectory() as tmp:
            internal = self._internal_dir(tmp, riot_display="26.17", third_party="26.16")

            label = _latest_patch_label(
                internal, "16.17.8104348+branch.releases-16-17.content.release"
            )

            self.assertEqual(label, "26.17")
            self.assertNotEqual(
                label, "26.16",
                "CDragon 16.17 mechanics were labelled with arammayhem's lagging feed patch",
            )

    def test_the_third_party_feed_patch_is_left_alone(self):
        """Fixing the label must not drag lagging statistics forward."""
        with tempfile.TemporaryDirectory() as tmp:
            internal = self._internal_dir(tmp, riot_display="26.17", third_party="26.16")

            _latest_patch_label(
                internal, "16.17.8104348+branch.releases-16-17.content.release"
            )

            meta = json.loads((internal / "meta.json").read_text(encoding="utf-8"))
            self.assertEqual(
                meta["patch"], "26.16",
                "the statistical feed must keep describing the patch it actually observed",
            )

    def test_without_riot_metadata_it_falls_back_to_the_build_not_the_feed(self):
        """No Riot authority means we do not know the display patch.

        Naming the runtime build is honest; borrowing a third party's patch is a
        guess that looks like an observation.
        """
        with tempfile.TemporaryDirectory() as tmp:
            internal = self._internal_dir(tmp, riot_display=None, third_party="26.16")
            version = "16.17.8104348+branch.releases-16-17.content.release"

            self.assertEqual(_latest_patch_label(internal, version), version)


if __name__ == "__main__":
    unittest.main()
