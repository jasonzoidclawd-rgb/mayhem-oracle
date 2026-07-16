#!/usr/bin/env python3

from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from verify_live_jsonld import (
    DEFAULT_LOCALE,
    ENTITY_TYPES,
    REPO_ROOT,
    SUPPORTED_LOCALES,
    JsonLdCheck,
    check_detail_graph,
    extract_json_ld_blocks,
    find_detail_graph,
    forbidden_hits,
    load_routing_config,
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


def write_routing_fixture(
    root: Path,
    *,
    locales: list[str],
    default_locale: str = "en",
    message_locales: list[str] | None = None,
) -> None:
    routing_dir = root / "src" / "i18n"
    routing_dir.mkdir(parents=True)
    routing_dir.joinpath("routing.ts").write_text(
        "import { defineRouting } from \"next-intl/routing\";\n\n"
        "export const routing = defineRouting({\n"
        f"  locales: {locales!r},\n"
        f"  defaultLocale: \"{default_locale}\",\n"
                "  localePrefix: \"always\",\n"
        "});\n"
    )

    messages_dir = root / "messages"
    messages_dir.mkdir()
    for locale in message_locales if message_locales is not None else locales:
        messages_dir.joinpath(f"{locale}.json").write_text("{}\n")


class JsonLdVerifierTests(unittest.TestCase):
    def test_supported_locales_are_loaded_from_routing(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            write_routing_fixture(root, locales=["en", "fr", "ja"])

            config = load_routing_config(root)

        self.assertEqual(config.locales, ("en", "fr", "ja"))
        self.assertEqual(config.default_locale, "en")

    def test_shipped_routed_locales_have_messages(self) -> None:
        config = load_routing_config(REPO_ROOT)

        self.assertEqual(config.default_locale, DEFAULT_LOCALE)
        self.assertEqual(list(config.locales), SUPPORTED_LOCALES)
        for locale in config.locales:
            self.assertTrue((REPO_ROOT / "messages" / f"{locale}.json").is_file())

    def test_routing_default_must_match_explicit_default(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            write_routing_fixture(root, locales=["en", "fr"], default_locale="fr")

            with self.assertRaisesRegex(RuntimeError, "default locale"):
                load_routing_config(root)

    def test_each_routed_locale_requires_a_messages_file(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            write_routing_fixture(
                root,
                locales=["en", "fr"],
                message_locales=["en"],
            )

            with self.assertRaisesRegex(RuntimeError, "messages/fr.json"):
                load_routing_config(root)

    def test_locale_paths_prefix_every_locale(self) -> None:
        for locale in SUPPORTED_LOCALES:
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
