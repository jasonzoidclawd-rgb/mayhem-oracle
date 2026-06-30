#!/usr/bin/env python3

import unittest
from io import StringIO
from unittest.mock import patch

from check_data_freshness import (
    compare_patches,
    freshness_status,
    main,
    resolve_upstream_patch,
)


class DataFreshnessTests(unittest.TestCase):
    def test_compare_patches_uses_numeric_ordering(self):
        self.assertLess(compare_patches("26.12", "26.13"), 0)
        self.assertGreater(compare_patches("26.13", "26.12"), 0)
        self.assertGreater(compare_patches("26.10", "26.9"), 0)
        self.assertEqual(compare_patches("26.13", "26.13"), 0)

    def test_resolve_upstream_patch_uses_highest_search_or_page_patch(self):
        upstream = resolve_upstream_patch(
            {"patch": "26.13"},
            [
                "<html>Patch 26.12</html>",
                "<html>Patch 26.11</html>",
            ],
        )

        self.assertEqual(upstream, "26.13")

    def test_freshness_status_flags_stale_published_data(self):
        self.assertEqual(freshness_status("26.12", "26.13"), "stale")
        self.assertEqual(freshness_status("26.13", "26.13"), "fresh")
        self.assertEqual(freshness_status("26.14", "26.13"), "fresh")

    def test_main_reports_fresh_json_with_zero_exit(self):
        out = StringIO()
        with patch("sys.argv", ["check", "--published-patch", "26.13", "--upstream-patch", "26.13", "--json"]):
            with patch("sys.stdout", out):
                main()

        self.assertIn('"status": "fresh"', out.getvalue())

    def test_main_reports_stale_json_with_exit_2(self):
        out = StringIO()
        with patch("sys.argv", ["check", "--published-patch", "26.12", "--upstream-patch", "26.13", "--json"]):
            with patch("sys.stdout", out):
                with self.assertRaises(SystemExit) as cm:
                    main()

        self.assertEqual(cm.exception.code, 2)
        self.assertIn('"status": "stale"', out.getvalue())

    def test_main_reports_unknown_json_when_upstream_fetch_fails(self):
        out = StringIO()
        with patch("sys.argv", ["check", "--published-patch", "26.13", "--json"]):
            with patch("check_data_freshness.fetch_upstream_patch", side_effect=RuntimeError("upstream unavailable")):
                with patch("sys.stdout", out):
                    with self.assertRaises(SystemExit) as cm:
                        main()

        self.assertEqual(cm.exception.code, 1)
        self.assertIn('"status": "unknown"', out.getvalue())
        self.assertIn('"upstream_error": "upstream unavailable"', out.getvalue())


if __name__ == "__main__":
    unittest.main()
