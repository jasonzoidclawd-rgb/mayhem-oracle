#!/usr/bin/env python3

import json
import tempfile
import time as time_module
import unittest
from pathlib import Path
from typing import Optional
from urllib.error import URLError
from unittest.mock import patch

import scrape_patch_notes as scraper


EN_PATCH_HTML = """
<html>
  <body>
    <h1 data-testid="title">League of Legends Patch 26.13 Notes</h1>
    <time datetime="2026-06-25T12:00:00Z"></time>
    <h2>ARAM: Mayhem</h2>
    <h4>Augments</h4>
    <p><strong>Quest: Angel of Retribution</strong></p>
    <ul><li>Damage: 10 ⇒ 12</li></ul>
  </body>
</html>
"""

ZH_TW_PATCH_HTML = """
<html>
  <body>
    <h1 data-testid="title">英雄聯盟 26.13 版本更新公告</h1>
    <time datetime="2026-06-25T12:00:00Z"></time>
    <h2>隨機單中：大混戰</h2>
    <h4>增幅裝置</h4>
    <p><strong>復仇天使任務</strong></p>
    <ul><li>傷害: 10 ⇒ 12</li></ul>
  </body>
</html>
"""


class ScrapePatchNotesLocalePipelineTests(unittest.TestCase):
    def _run_fixture_scrape(self, out_dir: Path) -> dict:
        en_path = "/en-us/news/game-updates/league-of-legends-patch-26-13-notes"
        zh_tw_path = "/zh-tw/news/game-updates/league-of-legends-patch-26-13-notes"

        def fixture_fetch(path_or_url: str) -> str:
            if path_or_url == en_path:
                return EN_PATCH_HTML
            if path_or_url == zh_tw_path:
                return ZH_TW_PATCH_HTML
            raise URLError(f"fixture has no response for {path_or_url}")

        empty_catalogs = {
            "indexes": {"champion": {}, "item": {}, "augment": {}, "ability": {}},
            "scanRefs": [],
        }

        with patch("sys.argv", ["scrape_patch_notes.py"]):
            with patch.object(scraper, "OUT_DIR", out_dir):
                with patch.object(scraper, "discover_patch_paths", return_value=[en_path]):
                    with patch.object(scraper, "fetch", side_effect=fixture_fetch):
                        with patch.object(scraper, "load_entity_catalogs", return_value=empty_catalogs):
                            with patch.object(scraper, "update_augment_recent_changes"):
                                with patch.object(scraper.time, "sleep"):
                                    scraper.main()

        return json.loads((out_dir / "patch-notes.json").read_text(encoding="utf-8"))

    def _classified_kind(
        self,
        section_id: str,
        text: str,
        *,
        source_type: Optional[str] = None,
    ) -> str:
        change = {
            "subject": "Fixture",
            "text": text,
        }
        if source_type:
            change["sourceType"] = source_type
        patch = {
            "version": "26.13",
            "sections": [
                {
                    "id": section_id,
                    "title": section_id,
                    "changes": [change],
                },
            ],
        }

        scraper.classify_patch(patch)

        return patch["sections"][0]["changes"][0]["kind"]

    def test_load_entity_catalogs_includes_localized_ref_names(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            out_dir = Path(tmpdir)
            (out_dir / "champions.json").write_text(
                json.dumps({
                    "champions": [{
                        "slug": "brand",
                        "name": "Brand",
                        "tags": ["mage"],
                        "kit_tags": ["burn"],
                        "name_zh_TW": "布蘭德",
                        "name_zh_CN": "复仇焰魂",
                        "name_ja": "ブランド",
                        "name_ko": "브랜드",
                    }],
                }),
                encoding="utf-8",
            )
            (out_dir / "items.json").write_text(
                json.dumps({
                    "items": [{
                        "id": 123,
                        "name": "The Golden Spatula",
                        "name_zh_TW": "黃金鍋鏟",
                        "name_zh_CN": "金铲铲",
                        "name_ja": "ザ・金のへら",
                        "name_ko": "황금 뒤집개",
                    }],
                }),
                encoding="utf-8",
            )
            (out_dir / "augments.json").write_text(
                json.dumps({
                    "augments": [{
                        "slug": "tank-engine",
                        "name": "Tank Engine",
                        "availability": {"status": "confirmed_live"},
                        "flags": {},
                        "name_zh_TW": "坦克引擎",
                        "name_zh_CN": "坦克引擎",
                        "name_ja": "タンクエンジン",
                        "name_ko": "탱크 엔진",
                    }],
                }),
                encoding="utf-8",
            )
            (out_dir / "abilities.json").write_text(
                json.dumps({
                    "profiles": {
                        "brand": {
                            "abilities": [{
                                "key": "P",
                                "name": "Blaze",
                                "name_zh_TW": "烈炎鐵血",
                                "name_zh_CN": "炽热之焰",
                                "name_ja": "炎上",
                                "name_ko": "불길",
                            }],
                        },
                    },
                }),
                encoding="utf-8",
            )

            with patch.object(scraper, "OUT_DIR", out_dir):
                catalogs = scraper.load_entity_catalogs()

        champion = catalogs["indexes"]["champion"][scraper.normalize_key("Brand")]
        item = catalogs["indexes"]["item"][scraper.normalize_key("The Golden Spatula")]
        augment = catalogs["indexes"]["augment"][scraper.normalize_key("Tank Engine")]
        ability = catalogs["indexes"]["ability"][scraper.normalize_key("Blaze")]

        self.assertEqual(champion["names"]["zh-tw"], "布蘭德")
        self.assertEqual(item["names"]["zh-cn"], "金铲铲")
        self.assertEqual(augment["names"]["ja-jp"], "タンクエンジン")
        self.assertEqual(ability["names"]["ko-kr"], "불길")

    def test_bugfix_section_classifies_as_fixed(self):
        self.assertEqual(
            self._classified_kind("bugfixes", "Fixed an issue where rerolls could misreport."),
            "fixed",
        )

    def test_new_items_section_classifies_as_added(self):
        self.assertEqual(
            self._classified_kind("new_items", "Atma's Reckoning has entered the shop."),
            "added",
        )

    def test_new_champion_preview_classifies_as_added(self):
        self.assertEqual(
            self._classified_kind(
                "champions",
                "Q damage: 40 ⇒ 50",
                source_type="new_champion_preview",
            ),
            "added",
        )

    def test_explicit_removal_phrasing_classifies_as_removed(self):
        for text in (
            "This augment has been removed.",
            "Removed from the augment pool.",
            "This system has been disabled.",
        ):
            with self.subTest(text=text):
                self.assertEqual(self._classified_kind("augments", text), "removed")

    def test_numeric_balance_changes_still_classify_as_buffed_or_nerfed(self):
        self.assertEqual(self._classified_kind("augments", "Damage: 10 ⇒ 12"), "buffed")
        self.assertEqual(self._classified_kind("augments", "Damage: 12 ⇒ 10"), "nerfed")

    def test_main_uses_article_published_at_as_scraped_at(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            doc = self._run_fixture_scrape(Path(tmpdir))

        self.assertEqual(doc["scraped_at"], "2026-06-25T12:00:00Z")

    def test_fixture_scrape_is_byte_stable_across_runs(self):
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            self._run_fixture_scrape(Path(first))
            time_module.sleep(0.001)
            self._run_fixture_scrape(Path(second))

            self.assertEqual(
                (Path(first) / "patch-notes.json").read_bytes(),
                (Path(second) / "patch-notes.json").read_bytes(),
            )

    def test_main_stitches_successfully_parsed_zh_tw_text(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            doc = self._run_fixture_scrape(Path(tmpdir))

        change = doc["patches"][0]["sections"][0]["changes"][0]
        self.assertIn("zh-tw", change["text"])
        self.assertIn("zh-tw", change["subject"])
        self.assertEqual(change["text"]["zh-tw"], "傷害: 10 ⇒ 12")
        self.assertEqual(change["subject"]["zh-tw"], "復仇天使任務")


if __name__ == "__main__":
    unittest.main()
