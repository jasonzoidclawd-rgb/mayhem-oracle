#!/usr/bin/env python3
"""Riot prose is metadata only; CDragon owns structured entity changes."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cdragon_snapshot_diff import build_snapshot, compare_snapshots
import scrape_patch_notes as scraper


PATCH_HTML = """
<html><body>
  <h1 data-testid="title">League of Legends Patch 26.13 Notes</h1>
  <time datetime="2026-06-25T12:00:00Z"></time>
  <div class="authors"><span>Riot Fixture, Riot Editor</span></div>
  <blockquote class="context">A prose-only introduction.</blockquote>
  <h2>Champions</h2><h3>Brand</h3><p>Q damage: 80 ⇒ 90</p>
</body></html>
"""


class PatchMetadataOnlyTests(unittest.TestCase):
    def test_extracts_only_title_date_url_and_attribution(self):
        path = "/en-us/news/game-updates/league-of-legends-patch-26-13-notes"
        document = scraper.build_metadata_document([path], fetcher=lambda _: PATCH_HTML)

        self.assertEqual(document["patch"], "26.13")
        self.assertEqual(document["patches"][0], {
            "version": "26.13",
            "articleTitle": "League of Legends Patch 26.13 Notes",
            "publishedAt": "2026-06-25T12:00:00Z",
            "sourceUrl": "https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-13-notes",
            "authors": ["Riot Fixture", "Riot Editor"],
            "intro": "A prose-only introduction.",
        })
        encoded = json.dumps(document)
        for forbidden in ("sections", "changes", "kind", "subject", "targets", "metrics"):
            self.assertNotIn(f'"{forbidden}"', encoded)

    def test_fixture_output_is_byte_stable(self):
        path = "/en-us/news/game-updates/league-of-legends-patch-26-13-notes"
        first = scraper.build_metadata_document([path], fetcher=lambda _: PATCH_HTML)
        second = scraper.build_metadata_document([path], fetcher=lambda _: PATCH_HTML)
        self.assertEqual(
            json.dumps(first, ensure_ascii=False, sort_keys=True),
            json.dumps(second, ensure_ascii=False, sort_keys=True),
        )

    def test_main_writes_patch_metadata_not_a_structural_patch_feed(self):
        path = "/en-us/news/game-updates/league-of-legends-patch-26-13-notes"
        with tempfile.TemporaryDirectory() as tmpdir:
            out = Path(tmpdir)
            with patch("sys.argv", ["scrape_patch_notes.py", "--out-dir", str(out)]):
                with patch.object(scraper, "discover_patch_paths", return_value=[path]):
                    with patch.object(scraper, "fetch", return_value=PATCH_HTML):
                        scraper.main()
            payload = json.loads((out / "patch-metadata.json").read_text(encoding="utf-8"))

        self.assertEqual(payload["patches"][0]["version"], "26.13")
        self.assertFalse((out / "patch-notes.json").exists())

    def test_structural_change_absent_from_prose_is_still_detected_by_snapshot_diff(self):
        before = build_snapshot(
            entity_type="item", branch="latest", source_version="16.13.1",
            source_patch_label="26.13", observed_at="2026-07-11T00:00:00Z",
            entities=[{"id": "1001", "slug": "boots", "names": {"en": "Boots"}, "fields": {"cost": 300}}],
        )
        after = build_snapshot(
            entity_type="item", branch="latest", source_version="16.13.2",
            source_patch_label="26.13", observed_at="2026-07-11T01:00:00Z",
            entities=[{"id": "1001", "slug": "boots", "names": {"en": "Boots"}, "fields": {"cost": 350}}],
        )
        event = compare_snapshots(before, after, detected_at="2026-07-11T01:00:00Z")[0]
        prose = scraper.build_metadata_document(
            ["/en-us/news/game-updates/league-of-legends-patch-26-13-notes"],
            fetcher=lambda _: PATCH_HTML,
        )

        self.assertEqual(event["entity_type"], "item")
        self.assertEqual(event["fields_changed"], ["cost"])
        self.assertNotIn("boots", json.dumps(prose).lower())


if __name__ == "__main__":
    unittest.main()
