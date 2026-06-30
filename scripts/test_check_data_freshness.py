#!/usr/bin/env python3

import unittest

from check_data_freshness import (
    compare_patches,
    freshness_status,
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


if __name__ == "__main__":
    unittest.main()
