#!/usr/bin/env python3

import json
import tempfile
import unittest
from pathlib import Path
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
    def test_main_stitches_successfully_parsed_zh_tw_text(self):
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

        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("sys.argv", ["scrape_patch_notes.py"]):
                with patch.object(scraper, "OUT_DIR", Path(tmpdir)):
                    with patch.object(scraper, "discover_patch_paths", return_value=[en_path]):
                        with patch.object(scraper, "fetch", side_effect=fixture_fetch):
                            with patch.object(scraper, "load_entity_catalogs", return_value=empty_catalogs):
                                with patch.object(scraper, "update_augment_recent_changes"):
                                    with patch.object(scraper.time, "sleep"):
                                        scraper.main()

            doc = json.loads((Path(tmpdir) / "patch-notes.json").read_text(encoding="utf-8"))

        change = doc["patches"][0]["sections"][0]["changes"][0]
        self.assertIn("zh-tw", change["text"])
        self.assertIn("zh-tw", change["subject"])
        self.assertEqual(change["text"]["zh-tw"], "傷害: 10 ⇒ 12")
        self.assertEqual(change["subject"]["zh-tw"], "復仇天使任務")


if __name__ == "__main__":
    unittest.main()
