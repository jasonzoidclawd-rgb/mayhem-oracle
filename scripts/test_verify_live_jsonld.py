#!/usr/bin/env python3

from __future__ import annotations

import unittest

from verify_live_jsonld import (
    ENTITY_TYPES,
    SUPPORTED_LOCALES,
    JsonLdCheck,
    check_detail_graph,
    extract_json_ld_blocks,
    find_detail_graph,
    forbidden_hits,
    localized_path,
    normalize_base_url,
    summarize_checks,
)


def detail_graph(entity_type: str, locale: str, home: str) -> list[dict]:
    return [
        {"@type": "WebPage", "inLanguage": locale, "name": "Tank Engine"},
        {
            "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "item": home},
                {"@type": "ListItem", "position": 2, "item": f"{home}/augments"},
            ],
        },
        {"@type": entity_type, "name": "Tank Engine"},
    ]


def page_html(graph: list[dict]) -> str:
    import json

    website = '<script type="application/ld+json">{"@type": "WebSite"}</script>'
    detail = (
        '<script type="application/ld+json">'
        + json.dumps({"@context": "https://schema.org", "@graph": graph})
        + "</script>"
    )
    return f"<html><head>{website}{detail}</head><body></body></html>"


class JsonLdVerifierTests(unittest.TestCase):
    def test_locale_paths_prefix_every_non_default_locale(self) -> None:
        self.assertEqual(localized_path("/augments/tank-engine", "en"), "/augments/tank-engine")
        for locale in SUPPORTED_LOCALES[1:]:
            self.assertEqual(
                localized_path("/augments/tank-engine", locale),
                f"/{locale}/augments/tank-engine",
            )

    def test_normalize_base_url_strips_trailing_slash(self) -> None:
        self.assertEqual(normalize_base_url("https://wasfun.lol/"), "https://wasfun.lol")

    def test_extracts_and_finds_the_detail_graph_only(self) -> None:
        graph = detail_graph("DefinedTerm", "zh-TW", "https://wasfun.lol/zh-TW")
        blocks = extract_json_ld_blocks(page_html(graph))

        self.assertEqual(len(blocks), 2)
        found = find_detail_graph(blocks)
        self.assertIsNotNone(found)
        self.assertEqual(found[0]["@type"], "WebPage")

    def test_valid_graph_passes_all_checks(self) -> None:
        graph = detail_graph("DefinedTerm", "zh-TW", "https://wasfun.lol/zh-TW")
        failures = check_detail_graph(graph, "DefinedTerm", "zh-TW", "https://wasfun.lol/zh-TW")
        self.assertEqual(failures, [])

    def test_wrong_language_type_and_home_are_reported(self) -> None:
        graph = detail_graph("Thing", "en", "https://wasfun.lol")
        failures = check_detail_graph(graph, "Person", "ja", "https://wasfun.lol/ja")

        self.assertTrue(any("graph types" in failure for failure in failures))
        self.assertTrue(any("inLanguage" in failure for failure in failures))
        self.assertTrue(any("breadcrumb home" in failure for failure in failures))

    def test_forbidden_terms_are_detected_inside_json_ld_only(self) -> None:
        clean = extract_json_ld_blocks(
            page_html(detail_graph("DefinedTerm", "en", "https://wasfun.lol"))
        )
        self.assertEqual(forbidden_hits(clean), [])

        poisoned = detail_graph("DefinedTerm", "en", "https://wasfun.lol")
        poisoned[0]["description"] = "oracleScore 99 from data/internal"
        hits = forbidden_hits(extract_json_ld_blocks(page_html(poisoned)))
        self.assertIn("oracleScore", hits)
        self.assertIn("data/internal", hits)

    def test_summary_counts_failures(self) -> None:
        summary = summarize_checks(
            [
                JsonLdCheck("en:augment", True),
                JsonLdCheck("ja:item", False, "breadcrumb home mismatch"),
            ]
        )

        self.assertEqual(summary["checked"], 2)
        self.assertEqual(summary["passed"], 1)
        self.assertFalse(summary["ok"])
        self.assertEqual(summary["failures"][0]["name"], "ja:item")

    def test_entity_type_map_matches_shipped_builders(self) -> None:
        self.assertEqual(
            ENTITY_TYPES,
            {"augment": "DefinedTerm", "item": "Thing", "champion": "Person"},
        )


if __name__ == "__main__":
    unittest.main()
