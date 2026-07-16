#!/usr/bin/env python3

from __future__ import annotations

import json
import unittest

from verify_live_patch_seo import (
    SUPPORTED_LOCALES,
    SeoCheck,
    build_expected_routes,
    extract_json_ld_nodes,
    localized_path,
    normalize_base_url,
    parse_sitemap_urls,
    patch_note_section_anchor,
    summarize_checks,
)


def patch_notes_fixture() -> dict:
    return {
        "patch": "26.13",
        "patches": [
            {
                "version": "26.13",
                "released": "2026-06-23",
                "title": "League of Legends Patch 26.13 Notes",
                "sections": [
                    {"id": "champions", "title": "Champions", "changes": [{}]},
                    {"id": "augments", "title": "Augments", "changes": [{}]},
                ],
            },
            {
                "version": "26.12",
                "publishedAt": "2026-06-11T12:00:00Z",
                "title": "League of Legends Patch 26.12 Notes",
                "sections": [
                    {"id": "items", "title": "Items", "changes": [{}]},
                ],
            },
        ],
    }


class VerifyLivePatchSeoTests(unittest.TestCase):
    def test_normalize_base_url_accepts_cli_or_env_style_values(self):
        self.assertEqual(
            normalize_base_url("https://wasfun.lol///"),
            "https://wasfun.lol",
        )
        self.assertEqual(
            normalize_base_url(" https://wasfun.lol/zh-TW/ "),
            "https://wasfun.lol/zh-TW",
        )

        with self.assertRaisesRegex(ValueError, "base URL"):
            normalize_base_url("")
        with self.assertRaisesRegex(ValueError, "http"):
            normalize_base_url("wasfun.lol")

    def test_build_expected_routes_matches_next_intl_locale_prefixes(self):
        routes = build_expected_routes(patch_notes_fixture())

        self.assertEqual(SUPPORTED_LOCALES, ("en", "zh-TW", "zh-CN", "ja", "ko"))
        self.assertEqual(localized_path("/patch-notes", "en"), "/en/patch-notes")
        self.assertEqual(
            localized_path("/patch-notes/26.13", "zh-TW"),
            "/zh-TW/patch-notes/26.13",
        )
        self.assertEqual(routes.list_paths[0], "/en/patch-notes")
        self.assertIn("/zh-CN/patch-notes", routes.list_paths)
        self.assertIn("/en/patch-notes/26.13", routes.detail_paths)
        self.assertIn("/ko/patch-notes/26.12", routes.detail_paths)
        self.assertEqual(routes.newest_patch["version"], "26.13")

    def test_parse_sitemap_urls_handles_namespaced_xml(self):
        xml = """<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://wasfun.lol/en/patch-notes</loc></url>
          <url><loc>https://wasfun.lol/zh-TW/patch-notes/26.13</loc></url>
        </urlset>
        """

        self.assertEqual(
            parse_sitemap_urls(xml),
            {
                "https://wasfun.lol/en/patch-notes",
                "https://wasfun.lol/zh-TW/patch-notes/26.13",
            },
        )

    def test_extract_json_ld_nodes_flattens_graph_scripts(self):
        graph = {
            "@context": "https://schema.org",
            "@graph": [
                {"@type": "Article", "headline": "Patch 26.13 Notes"},
                {
                    "@type": "BreadcrumbList",
                    "itemListElement": [
                        {"position": 1, "name": "Mayhem Oracle"},
                        {"position": 2, "name": "Patch Notes"},
                        {"position": 3, "name": "Patch 26.13"},
                    ],
                },
            ],
        }
        html = f"""
        <html>
          <head>
            <script type="application/ld+json">{json.dumps(graph)}</script>
          </head>
        </html>
        """

        nodes = extract_json_ld_nodes(html)

        self.assertEqual([node["@type"] for node in nodes], ["Article", "BreadcrumbList"])

    def test_section_anchor_matches_app_helper_shape(self):
        self.assertEqual(
            patch_note_section_anchor("26.13", "New Items"),
            "patch-26-13-new-items",
        )
        self.assertEqual(
            patch_note_section_anchor("26.13", "!!!"),
            "patch-26-13-section",
        )

    def test_summarize_checks_reports_failures_and_exit_status(self):
        checks = [
            SeoCheck("sitemap", "https://wasfun.lol/sitemap.xml", True, []),
            SeoCheck(
                "detail",
                "https://wasfun.lol/en/patch-notes/26.13",
                False,
                ["missing canonical", "missing Article JSON-LD"],
            ),
        ]

        summary = summarize_checks(checks)

        self.assertEqual(summary["ok"], False)
        self.assertEqual(summary["checked"], 2)
        self.assertEqual(summary["passed"], 1)
        self.assertEqual(summary["failed"], 1)
        self.assertEqual(
            summary["failures"],
            [
                {
                    "kind": "detail",
                    "url": "https://wasfun.lol/en/patch-notes/26.13",
                    "messages": ["missing canonical", "missing Article JSON-LD"],
                }
            ],
        )


if __name__ == "__main__":
    unittest.main()
