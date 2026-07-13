#!/usr/bin/env python3

import unittest

from assemble_augments import (
    assemble_catalog,
    lifecycle_for_availability,
    resolve_availability,
)


def base_row(augment_id: str, name: str = "Test Augment") -> dict:
    return {
        "augmentId": augment_id,
        "cdragon": {"augmentNameId": augment_id, "arenaApiName": name.replace(" ", "")},
        "name": name,
        "names": {
            "en": name,
            "zh_cn": f"{name} zh-CN",
            "zh_tw": f"{name} zh-TW",
            "ja": f"{name} ja",
            "ko": f"{name} ko",
        },
        "rarity": "gold",
        "icon": {
            "large": "assets/ux/cherry/augments/icons/test_large.png",
            "small": "assets/ux/cherry/augments/icons/test_small.png",
            "rosterSmall": "/lol-game-data/assets/ASSETS/UX/Cherry/Augments/Icons/Test_small.png",
        },
        "effectText": {"desc": "CDragon desc.", "tooltip": "CDragon tooltip."},
        "effectTextByLocale": {"en": {"desc": "CDragon desc.", "tooltip": "CDragon tooltip."}},
        "dataValues": {"Amount": [1.0]},
        "calculations": {"AmountCalc": {"__type": "GameCalculation"}},
        "definitionPlaceholder": False,
        "provenance": {"definition": "cdragon", "name": "cdragon:test"},
    }


class AvailabilityResolverTests(unittest.TestCase):
    def test_legacy_only_resolves_unverified_legacy_non_live(self):
        availability = resolve_availability(
            augment_id=None,
            slug="legacy-only",
            cdragon_present=False,
            wiki_row=None,
            definition_placeholder=False,
            tombstone_removed=False,
            existing_lifecycle="active",
        )

        self.assertEqual(availability["status"], "unverified_legacy")
        self.assertEqual(lifecycle_for_availability(availability["status"]), "removed")
        self.assertFalse(availability["signals"]["cdragon_registry"]["present"])
        self.assertFalse(availability["signals"]["wiki"]["present"])

    def test_registry_only_resolves_candidate_registry_present(self):
        availability = resolve_availability(
            augment_id="ARAM_RegistryOnly",
            slug="registry-only",
            cdragon_present=True,
            kiwi_present=False,
            wiki_row=None,
            definition_placeholder=False,
            tombstone_removed=False,
        )

        self.assertEqual(availability["status"], "candidate_registry_present")
        self.assertEqual(lifecycle_for_availability(availability["status"]), "removed")
        self.assertTrue(availability["signals"]["cdragon_registry"]["present"])
        self.assertFalse(availability["signals"]["kiwi"]["present"])
        self.assertFalse(availability["signals"]["wiki"]["present"])

    def test_registry_with_kiwi_resolves_confirmed_live(self):
        availability = resolve_availability(
            augment_id="ARAM_RegistryWithKiwi",
            slug="registry-with-kiwi",
            cdragon_present=True,
            kiwi_present=True,
            kiwi_keys=["kiwi_registrywithkiwi_name"],
            kiwi_tokens=["registrywithkiwi"],
            wiki_row=None,
            definition_placeholder=False,
            tombstone_removed=False,
        )

        self.assertEqual(availability["status"], "confirmed_live")
        self.assertEqual(lifecycle_for_availability(availability["status"]), "active")
        self.assertTrue(availability["signals"]["cdragon_registry"]["present"])
        self.assertTrue(availability["signals"]["kiwi"]["present"])
        self.assertEqual(availability["signals"]["wiki"]["status"], "absent")

    def test_wiki_currently_disabled_resolves_disabled(self):
        availability = resolve_availability(
            augment_id="ARAM_ClownCollege",
            slug="clown-college",
            cdragon_present=True,
            kiwi_present=True,
            wiki_row={"wikiAvailabilityNotes": ["This augment is currently disabled."]},
            definition_placeholder=False,
            tombstone_removed=False,
        )

        self.assertEqual(availability["status"], "disabled")
        self.assertEqual(lifecycle_for_availability(availability["status"]), "removed")
        self.assertEqual(availability["signals"]["wiki"]["status"], "disabled")

    def test_missing_ping_placeholder_never_becomes_confirmed_live(self):
        availability = resolve_availability(
            augment_id="ARAM_MissingPingAugment",
            slug="missing-ping-augment",
            cdragon_present=True,
            kiwi_present=True,
            wiki_row={"wikiDescription": "Placeholder should not be live evidence."},
            definition_placeholder=True,
            tombstone_removed=False,
        )

        self.assertEqual(availability["status"], "candidate_registry_present")
        self.assertNotEqual(availability["status"], "confirmed_live")
        self.assertTrue(availability["signals"]["cdragon_registry"]["definitionPlaceholder"])

    def test_placeholder_candidate_is_non_live_in_assembled_catalog(self):
        existing = {"patch": "26.12", "scraped_at": "old", "augments": []}
        placeholder_base = base_row("ARAM_MissingPingAugment", "Missing Ping Augment")
        placeholder_base["definitionPlaceholder"] = True
        base_catalog = {"generated_at": "2026-06-23T00:00:00+00:00", "augments": [placeholder_base]}
        wiki_feed = {
            "augments": {
                "ARAM_MissingPingAugment": {
                    "wikiDescription": "Placeholder should not be live evidence.",
                    "wikiAvailabilityNotes": [],
                }
            }
        }

        output = assemble_catalog(
            existing_catalog=existing,
            base_catalog=base_catalog,
            wiki_feed=wiki_feed,
            winrate_feed={"win_rates": {}},
            identity_map={"mappings": []},
        )

        row = output["augments"][0]
        self.assertEqual(row["availability"]["status"], "candidate_registry_present")
        self.assertEqual(row["flags"]["lifecycle"], "removed")

    def test_registry_with_wiki_live_resolves_confirmed_live(self):
        availability = resolve_availability(
            augment_id="ARAM_Live",
            slug="live",
            cdragon_present=True,
            wiki_row={"wikiDescription": "A current wiki row."},
            definition_placeholder=False,
            tombstone_removed=False,
        )

        self.assertEqual(availability["status"], "confirmed_live")
        self.assertEqual(lifecycle_for_availability(availability["status"]), "active")
        self.assertEqual(availability["signals"]["wiki"]["status"], "live")

    def test_stale_tombstone_removal_outranks_cdragon_and_wiki_live(self):
        availability = resolve_availability(
            augment_id="ARAM_Removed",
            slug="removed",
            cdragon_present=True,
            kiwi_present=True,
            wiki_row={"wikiDescription": "A current wiki row."},
            definition_placeholder=False,
            tombstone_removed=True,
        )

        self.assertEqual(availability["status"], "removed")
        self.assertEqual(lifecycle_for_availability(availability["status"]), "removed")
        self.assertTrue(availability["signals"]["tombstone"]["removed"])

    def test_explicit_patch_removed_stays_removed_even_with_registry_and_wiki_text(self):
        availability = resolve_availability(
            augment_id="Upgrade_SwordOfBlossom",
            slug="upgrade-sword-of-blossoming-dawn",
            cdragon_present=True,
            kiwi_present=True,
            wiki_row={"wikiDescription": "Stale wiki row."},
            definition_placeholder=False,
            tombstone_removed=True,
            patch_removed=True,
        )

        self.assertEqual(availability["status"], "removed")
        self.assertEqual(lifecycle_for_availability(availability["status"]), "removed")
        self.assertEqual(availability["signals"]["resolution"]["removedSources"], ["cdragon_diff", "tombstone"])

    def test_tencent_removed_overrides_stale_wiki_live(self):
        availability = resolve_availability(
            augment_id="ARAM_CurrentConflict",
            slug="current-conflict",
            cdragon_present=True,
            wiki_row={"wikiDescription": "A current wiki row."},
            definition_placeholder=False,
            tombstone_removed=False,
            kiwi_present=True,
            tencent_status="removed",
        )

        self.assertEqual(availability["status"], "removed")
        self.assertEqual(lifecycle_for_availability(availability["status"]), "removed")
        self.assertEqual(availability["signals"]["wiki"]["status"], "live")
        self.assertEqual(availability["signals"]["tencent"]["status"], "removed")

    def test_telemetry_live_conflicts_with_tencent_removed(self):
        availability = resolve_availability(
            augment_id="ARAM_ObservedConflict",
            slug="observed-conflict",
            cdragon_present=True,
            wiki_row=None,
            definition_placeholder=False,
            tombstone_removed=False,
            kiwi_present=True,
            tencent_status="removed",
            telemetry_status="observed_live",
        )

        self.assertEqual(availability["status"], "conflict")
        self.assertEqual(lifecycle_for_availability(availability["status"]), "removed")
        self.assertEqual(availability["signals"]["tencent"]["status"], "removed")
        self.assertEqual(availability["signals"]["telemetry"]["status"], "observed_live")

    def test_wiki_live_absent_from_cdragon_resolves_conflict(self):
        availability = resolve_availability(
            augment_id="ARAM_WikiOnly",
            slug="wiki-only",
            cdragon_present=False,
            kiwi_present=False,
            wiki_row={"wikiDescription": "A current wiki row."},
            definition_placeholder=False,
            tombstone_removed=False,
        )

        self.assertEqual(availability["status"], "conflict")
        self.assertEqual(lifecycle_for_availability(availability["status"]), "removed")
        self.assertEqual(availability["signals"]["wiki"]["status"], "live")

    def test_confirmed_live_preserves_corroboration_signals(self):
        availability = resolve_availability(
            augment_id="ARAM_Corroborated",
            slug="corroborated",
            cdragon_present=True,
            kiwi_present=True,
            wiki_row={"wikiDescription": "A current wiki row."},
            definition_placeholder=False,
            tombstone_removed=False,
            tencent_status="live",
        )

        self.assertEqual(availability["status"], "confirmed_live")
        self.assertTrue(availability["signals"]["kiwi"]["present"])
        self.assertEqual(availability["signals"]["wiki"]["status"], "live")
        self.assertEqual(availability["signals"]["tencent"]["status"], "live")
        self.assertEqual(availability["signals"]["resolution"]["liveSources"], ["wiki", "tencent"])

    def test_derived_removed_lifecycle_is_not_tombstone_evidence_on_rerun(self):
        existing = {
            "patch": "26.12",
            "scraped_at": "old",
            "augments": [
                {
                    "slug": "legacy-only",
                    "name": "Legacy Only",
                    "rarity": "gold",
                    "win_rate": None,
                    "icon": "https://example.test/legacy.png",
                    "name_zh_CN": "legacy zh-CN",
                    "name_zh_TW": "legacy zh-TW",
                    "name_ja": "legacy ja",
                    "name_ko": "legacy ko",
                    "kit_tags": [],
                    "flags": {"system_breaker": False, "lifecycle": "removed"},
                    "availability": {
                        "status": "unverified_legacy",
                        "signals": {
                            "tombstone": {"removed": False},
                        },
                    },
                    "type": "standalone",
                }
            ],
        }

        output = assemble_catalog(
            existing_catalog=existing,
            base_catalog={"generated_at": "2026-06-23T00:00:00+00:00", "augments": []},
            wiki_feed={"augments": {}},
            winrate_feed={"win_rates": {}},
            identity_map={"mappings": []},
        )

        row = output["augments"][0]
        self.assertEqual(row["availability"]["status"], "unverified_legacy")
        self.assertFalse(row["availability"]["signals"]["tombstone"]["removed"])
        self.assertEqual(row["flags"]["lifecycle"], "removed")

    def test_existing_cdragon_row_without_identity_mapping_stays_registry_backed_on_rerun(self):
        existing = {
            "patch": "26.12",
            "scraped_at": "old",
            "augments": [
                {
                    "augmentId": "ARAM_Earthwake",
                    "slug": "earthwake",
                    "name": "Earthwake",
                    "rarity": "prismatic",
                    "win_rate": None,
                    "icon": "https://example.test/earthwake.png",
                    "name_zh_CN": "earthwake zh-CN",
                    "name_zh_TW": "earthwake zh-TW",
                    "name_ja": "earthwake ja",
                    "name_ko": "earthwake ko",
                    "kit_tags": [],
                    "flags": {"system_breaker": False, "lifecycle": "active"},
                    "availability": {"status": "confirmed_live", "signals": {"tombstone": {"removed": False}}},
                    "type": "standalone",
                }
            ],
        }
        base_catalog = {
            "generated_at": "2026-06-23T00:00:00+00:00",
            "augments": [base_row("ARAM_Earthwake", "Earthwake")],
        }
        wiki_feed = {"augments": {"ARAM_Earthwake": {"wikiDescription": "A current wiki row."}}}

        output = assemble_catalog(
            existing_catalog=existing,
            base_catalog=base_catalog,
            wiki_feed=wiki_feed,
            winrate_feed={"win_rates": {}},
            identity_map={"mappings": []},
        )

        row = output["augments"][0]
        self.assertEqual(row["augmentId"], "ARAM_Earthwake")
        self.assertEqual(row["availability"]["status"], "confirmed_live")
        self.assertEqual(row["flags"]["lifecycle"], "active")
        self.assertFalse(row.get("legacyCatalogRow", False))

    def test_stale_candidate_tombstone_does_not_block_current_cdragon_kiwi_live(self):
        existing = {
            "patch": "26.12",
            "scraped_at": "old",
            "augments": [
                {
                    "augmentId": "ARAM_OrbitalLaser_Active",
                    "slug": "orbitallaser",
                    "name": "Orbital Laser",
                    "rarity": "gold",
                    "win_rate": None,
                    "icon": "https://example.test/orbitallaser.png",
                    "name_zh_CN": "orbitallaser zh-CN",
                    "name_zh_TW": "orbitallaser zh-TW",
                    "name_ja": "orbitallaser ja",
                    "name_ko": "orbitallaser ko",
                    "kit_tags": [],
                    "flags": {"system_breaker": False, "lifecycle": "removed"},
                    "availability": {
                        "status": "candidate_registry_present",
                        "signals": {
                            "patch_notes": {"removed": False},
                            "tombstone": {"removed": True},
                        },
                    },
                    "type": "standalone",
                }
            ],
        }
        base = base_row("ARAM_OrbitalLaser_Active", "Orbital Laser")
        base["cdragon"]["kiwi"] = {
            "present": True,
            "keys": ["kiwi_aram_orbitallaser_active_name"],
            "tokens": ["orbitallaseractive"],
        }

        output = assemble_catalog(
            existing_catalog=existing,
            base_catalog={"generated_at": "2026-06-23T00:00:00+00:00", "augments": [base]},
            wiki_feed={"augments": {}},
            winrate_feed={"win_rates": {}},
            identity_map={"mappings": []},
        )

        row = output["augments"][0]
        self.assertEqual(row["availability"]["status"], "confirmed_live")
        self.assertEqual(row["flags"]["lifecycle"], "active")
        self.assertFalse(row["availability"]["signals"]["tombstone"]["removed"])

    def test_removed_catalog_tombstone_stays_removed_without_current_live_evidence(self):
        existing = {
            "patch": "26.12",
            "scraped_at": "old",
            "augments": [
                {
                    "slug": "retired-augment",
                    "name": "Retired Augment",
                    "rarity": "gold",
                    "win_rate": None,
                    "icon": "https://example.test/retired.png",
                    "name_zh_CN": "retired zh-CN",
                    "name_zh_TW": "retired zh-TW",
                    "name_ja": "retired ja",
                    "name_ko": "retired ko",
                    "kit_tags": [],
                    "flags": {"system_breaker": False, "lifecycle": "removed"},
                    "availability": {
                        "status": "removed",
                        "signals": {
                            "patch_notes": {"removed": False},
                            "tombstone": {"removed": True},
                        },
                    },
                    "type": "standalone",
                }
            ],
        }

        output = assemble_catalog(
            existing_catalog=existing,
            base_catalog={"generated_at": "2026-06-23T00:00:00+00:00", "augments": []},
            wiki_feed={"augments": {}},
            winrate_feed={"win_rates": {}},
            identity_map={"mappings": []},
        )

        row = output["augments"][0]
        self.assertEqual(row["availability"]["status"], "removed")
        self.assertEqual(row["flags"]["lifecycle"], "removed")
        self.assertTrue(row["availability"]["signals"]["tombstone"]["removed"])


class AssembleCatalogTests(unittest.TestCase):
    def test_assembles_with_source_precedence_and_preserved_curated_fields(self):
        existing = {
            "patch": "26.12",
            "scraped_at": "old",
            "augments": [
                {
                    "slug": "adapt",
                    "name": "Old ADAPt",
                    "rarity": "prismatic",
                    "win_rate": 1.23,
                    "icon": "https://example.test/old.png",
                    "name_zh_CN": "old zh-CN",
                    "name_zh_TW": "old zh-TW",
                    "name_ja": "old ja",
                    "name_ko": "old ko",
                    "wikiDescription": "old wiki text",
                    "kit_tags": ["ability"],
                    "flags": {
                        "system_breaker": True,
                        "lifecycle": "active",
                        "availability_override": "bug_mechanism",
                        "availability_label": "BUG/MECHANISM",
                        "availability_source": "player-observed-live-game",
                        "availability_observed_at": "2026-06-20",
                    },
                    "type": "standalone",
                }
            ],
        }
        identity_map = {
            "mappings": [
                {
                    "augmentId": "ARAM_ADAPt",
                    "cdragon": {"name": "ADAPt", "slug": "adapt", "rarity": "silver"},
                    "sources": {
                        "internal_augments": [
                            {"slug": "adapt", "name": "Old ADAPt", "lifecycle": "active"}
                        ]
                    },
                }
            ]
        }
        base_catalog = {"generated_at": "2026-06-23T00:00:00+00:00", "augments": [base_row("ARAM_ADAPt", "ADAPt")]}
        wiki_feed = {
            "augments": {
                "ARAM_ADAPt": {
                    "wikiDescription": "Wiki display text.",
                    "wikiNotes": ["Wiki note."],
                    "wikiAvailabilityNotes": [],
                    "wikiFetchedAt": "2026-06-22T17:54:33+00:00",
                    "wikiRarity": "gold",
                }
            }
        }
        winrate_feed = {"win_rates": {"ARAM_ADAPt": 55.5}}

        output = assemble_catalog(
            existing_catalog=existing,
            base_catalog=base_catalog,
            wiki_feed=wiki_feed,
            winrate_feed=winrate_feed,
            identity_map=identity_map,
        )

        row = output["augments"][0]
        self.assertEqual(row["augmentId"], "ARAM_ADAPt")
        self.assertEqual(row["slug"], "adapt")
        self.assertEqual(row["name"], "ADAPt")
        self.assertEqual(row["rarity"], "gold")
        self.assertEqual(row["cdragonRarity"], "gold")
        self.assertTrue(row["icon"].startswith("https://raw.communitydragon.org/latest/plugins/"))
        self.assertEqual(row["effectText"]["tooltip"], "CDragon tooltip.")
        self.assertEqual(row["dataValues"], {"Amount": [1.0]})
        self.assertEqual(row["wikiDescription"], "Wiki display text.")
        self.assertEqual(row["wikiNotes"], ["Wiki note."])
        self.assertEqual(row["win_rate"], 55.5)
        self.assertEqual(row["kit_tags"], ["ability"])
        self.assertTrue(row["flags"]["system_breaker"])
        self.assertNotIn("availability_override", row["flags"])
        self.assertNotIn("availability_label", row["flags"])
        self.assertNotIn("availability_source", row["flags"])
        self.assertNotIn("availability_observed_at", row["flags"])
        self.assertEqual(row["type"], "standalone")
        self.assertEqual(row["availability"]["status"], "confirmed_live")
        self.assertEqual(row["flags"]["lifecycle"], "active")
        self.assertEqual(row["provenance"]["win_rate"], "arammayhem:augment-winrate-feed")
        self.assertEqual(row["provenance"]["wikiDescription"], "wiki:augment-wiki-feed")

    def test_assembled_catalog_uses_meta_patch_when_provided(self):
        output = assemble_catalog(
            existing_catalog={"patch": "26.12", "scraped_at": "old", "augments": []},
            base_catalog={"generated_at": "2026-06-23T00:00:00+00:00", "augments": []},
            wiki_feed={"augments": {}},
            winrate_feed={"win_rates": {}},
            identity_map={"mappings": []},
            patch="26.13",
        )

        self.assertEqual(output["patch"], "26.13")


if __name__ == "__main__":
    unittest.main()
