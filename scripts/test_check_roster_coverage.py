#!/usr/bin/env python3

from __future__ import annotations

import json
import unittest
from pathlib import Path

from check_roster_coverage import build_roster_report, load_json, report_errors


ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "scripts" / "fixtures" / "roster-coverage"


class RosterCoverageTests(unittest.TestCase):
    def test_published_numeric_champion_key_is_the_primary_roster_join(self):
        ddragon = load_json(FIXTURES / "ddragon-16.13.1.json")
        cdragon = load_json(FIXTURES / "cdragon-summary.json")
        published = {
            "champions": [
                {"slug": "brand", "champion_key": "63", "icon": "https://example.test/999.png"},
                {"slug": "locke", "champion_key": "805"},
            ]
        }

        report = build_roster_report(ddragon, published, cdragon)

        self.assertEqual(report["missing_active_champion_ids"], [])
        self.assertEqual(report["duplicate_published_ids"], {})

    def test_fixture_exposes_the_current_locke_gap(self):
        ddragon = load_json(FIXTURES / "ddragon-16.13.1.json")
        cdragon = load_json(FIXTURES / "cdragon-summary.json")
        published = load_json(FIXTURES / "published-missing-locke.json")

        report = build_roster_report(ddragon, published, cdragon)

        self.assertEqual(report["upstream_active_champion_count"], 2)
        self.assertEqual(report["missing_active_champion_count"], 1)
        self.assertEqual(report["missing_active_champion_ids"], ["805"])
        self.assertEqual(report["roster_coverage_ratio"], 0.5)
        self.assertEqual(report["communitydragon_missing_authority_ids"], [])

    def test_duplicate_ids_and_alias_collisions_are_reported(self):
        ddragon = load_json(FIXTURES / "ddragon-16.13.1.json")
        cdragon = load_json(FIXTURES / "cdragon-summary.json")
        published = {
            "champions": [
                {
                    "slug": "wukong",
                    "icon": "https://example.test/63.png",
                },
                {
                    "slug": "monkeyking",
                    "icon": "https://example.test/63.png",
                },
            ]
        }

        report = build_roster_report(ddragon, published, cdragon)

        self.assertEqual(report["duplicate_published_ids"], {"63": 2})
        self.assertEqual(report["alias_collisions"], {"monkeyking": ["monkeyking", "wukong"]})


class LocalizedIdentityCollapseTests(unittest.TestCase):
    """The pipeline must not exit 0 while publishing collapsed localized identity.

    BUG-4 shipped 171 of 173 champions carrying Lee Sin's localized names and
    every step still passed, because each row HAD a name and the roster join was
    on `champion_key`, which stayed correct. Only a later web test noticed.

    The invariant is structural, not a count: a localized name is a champion's
    identity in that locale, so a name shared by rows with different Riot keys
    means identity collapsed. That catches any future many-to-one join, not the
    Lee Sin incident specifically.
    """

    def _published(self, zh_tw_names):
        return {
            "champions": [
                {"slug": f"c{i}", "champion_key": key, "name": f"C{i}", "name_zh_TW": name}
                for i, (key, name) in enumerate(zh_tw_names)
            ]
        }

    def _report(self, published):
        ddragon = load_json(FIXTURES / "ddragon-16.13.1.json")
        cdragon = load_json(FIXTURES / "cdragon-summary.json")
        return build_roster_report(ddragon, published, cdragon)

    def test_collapsed_localized_names_are_an_error(self):
        # Three distinct champions, one localized name: the BUG-4 shape.
        published = self._published([("63", "李星"), ("67", "李星"), ("51", "李星")])

        errors = report_errors(self._report(published))

        self.assertTrue(
            any("collapsed" in e for e in errors),
            f"identity collapse was not reported: {errors}",
        )

    def test_distinct_localized_names_pass(self):
        published = self._published([("63", "布蘭德"), ("67", "汎"), ("51", "凱特琳")])

        errors = report_errors(self._report(published))

        self.assertEqual([e for e in errors if "collapsed" in e], [])

    def test_absent_localization_is_not_an_error(self):
        """Unlocalized rows are a separate concern; do not conflate them."""
        published = {
            "champions": [
                {"slug": "brand", "champion_key": "63", "name": "Brand"},
                {"slug": "vayne", "champion_key": "67", "name": "Vayne"},
            ]
        }

        errors = report_errors(self._report(published))

        self.assertEqual([e for e in errors if "collapsed" in e], [])


if __name__ == "__main__":
    unittest.main()
