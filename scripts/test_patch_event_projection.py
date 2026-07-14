#!/usr/bin/env python3
"""Presentation projections consume CDragon events, never prose structure."""

from __future__ import annotations

import json
import unittest

from patch_event_projection import build_patch_notes_projection, build_preview_projection


def event(**overrides: object) -> dict:
    base = {
        "entity_type": "champion",
        "canonical_id": "63",
        "slug": "brand",
        "names": {"en": "Brand", "zh-TW": "布蘭德"},
        "branch": "latest",
        "lane": "live",
        "change_kind": "numeric",
        "fields_changed": ["abilities.Q.cooldown"],
        "before": {"abilities.Q.cooldown": [8, 7, 6]},
        "after": {"abilities.Q.cooldown": [7, 6, 5]},
        "detected_at": "2026-07-11T01:00:00Z",
        "source_patch_label": "26.13",
        "landed": False,
        "is_hotfix": True,
    }
    base.update(overrides)
    return base


class PatchEventProjectionTests(unittest.TestCase):
    def test_cross_entity_gameplay_event_has_one_augment_subject_and_item_target(self):
        projection = build_patch_notes_projection(
            {
                "current_open_cycle": "26.13",
                "events": [event(
                    entity_type="augment",
                    canonical_id="ARAM_Quest_VoidImmolation",
                    slug="void-immolation",
                    names={"en": "Icathia's Fall"},
                    change_kind="mechanism",
                    fields_changed=["semantic.passives.Desolate"],
                    before={"semantic.passives.Desolate": {}},
                    after={"semantic.passives.Desolate": {"name": "Desolate"}},
                    change={
                        "category": "passive-added",
                        "name": "Desolate",
                        "description": "Killing an enemy deals magic damage around them.",
                    },
                    affected_entities=[{
                        "entity_type": "item",
                        "canonical_id": "223069",
                        "slug": "void-immolation",
                        "names": {"en": "Void Immolation"},
                    }],
                )],
            },
            {"patches": []},
            known={"champion": set(), "augment": {"void-immolation"}, "item": {"223069"}},
            entity_records={
                "augment": {"ARAM_Quest_VoidImmolation": {
                    "slug": "void-immolation", "known": True,
                    "route_identifier": "void-immolation", "lifecycle": {"state": "active"},
                }},
                "item": {"223069": {
                    "slug": "void-immolation", "known": True,
                    "route_identifier": "223069", "lifecycle": {"state": "active"},
                }},
            },
        )
        changes = projection["patches"][0]["sections"][0]["changes"]
        self.assertEqual(len(changes), 1)
        change = changes[0]
        self.assertEqual(change["kind"], "mechanism")
        self.assertEqual(change["targets"][0]["href"], "/augments/void-immolation")
        self.assertEqual(change["relatedEntities"][0]["href"], "/items/223069")
        self.assertEqual(change["text"]["en"], "Passive added: Desolate. Killing an enemy deals magic damage around them.")
        self.assertEqual(change["labels"], ["passive-added"])

    def test_live_projection_uses_snapshot_events_and_metadata_only(self):
        patch_events = {
            "current_open_cycle": "26.13",
            "observed_at": "2026-07-11T01:00:00Z",
            "events": [event()],
        }
        metadata = {
            "patches": [
                {
                    "version": "26.13",
                    "articleTitle": "Patch 26.13 Notes",
                    "publishedAt": "2026-06-25T12:00:00Z",
                    "sourceUrl": "https://riot.example/26-13",
                    "authors": ["Riot Fixture"],
                    "intro": "Metadata only.",
                },
                {
                    "version": "26.12",
                    "articleTitle": "Patch 26.12 Notes",
                    "publishedAt": "2026-06-11T12:00:00Z",
                    "sourceUrl": "https://riot.example/26-12",
                    "authors": [],
                    "intro": "",
                },
            ],
        }

        projection = build_patch_notes_projection(
            patch_events,
            metadata,
            known={"champion": {"brand"}, "item": set(), "augment": set()},
            entity_records={"champion": {"63": {"icon": "brand.png", "lifecycle": {"state": "active"}}}},
        )
        current, historical = projection["patches"]

        self.assertEqual(projection["source"], "CommunityDragon snapshot diffs")
        self.assertEqual(current["version"], "26.13")
        self.assertEqual(current["sections"][0]["id"], "champions")
        change = current["sections"][0]["changes"][0]
        self.assertEqual(change["kind"], "changed")
        self.assertEqual(change["targets"][0]["href"], "/champions/brand")
        self.assertEqual(change["targets"][0]["canonicalId"], "63")
        self.assertEqual(change["targets"][0]["icon"], "brand.png")
        self.assertEqual(change["text"]["en"], "Q Cooldown: [8, 7, 6] → [7, 6, 5]")
        self.assertEqual(change["text"]["zh-tw"], "Q 冷卻時間: [8, 7, 6] → [7, 6, 5]")
        self.assertEqual(historical["version"], "26.12")
        self.assertEqual(historical["sections"], [])
        self.assertNotIn("comparison", json.dumps(projection))

    def test_projection_keeps_only_current_open_live_cycle(self):
        projection = build_patch_notes_projection(
            {
                "current_open_cycle": "26.13",
                "observed_at": "2026-07-11T01:00:00Z",
                "events": [event(source_patch_label="26.12"), event(source_patch_label="26.13")],
            },
            {"patches": []},
        )

        self.assertEqual(len(projection["patches"]), 1)
        self.assertEqual(len(projection["patches"][0]["sections"][0]["changes"]), 1)

    def test_projection_uses_the_catalog_slug_for_canonical_entity_routes(self):
        projection = build_patch_notes_projection(
            {"current_open_cycle": "26.13", "events": [event(
                entity_type="augment",
                canonical_id="ARAM_ADAPt",
                slug="a-d-a-pt",
                names={"en": "ADAPt"},
            )]},
            {"patches": []},
            known={"champion": set(), "item": set(), "augment": {"adapt"}},
            entity_records={"augment": {"ARAM_ADAPt": {"slug": "adapt", "icon": "adapt.png"}}},
        )
        target = projection["patches"][0]["sections"][0]["changes"][0]["targets"][0]
        self.assertEqual(target["slug"], "adapt")
        self.assertEqual(target["href"], "/augments/adapt")
        self.assertEqual(target["icon"], "adapt.png")

    def test_projection_uses_catalog_localized_names_when_events_only_have_english(self):
        projection = build_patch_notes_projection(
            {"current_open_cycle": "26.13", "events": [event(
                entity_type="item",
                canonical_id="3152",
                slug="hextech-rocketbelt",
                names={"en": "Hextech Rocketbelt"},
            )]},
            {"patches": []},
            entity_records={"item": {"3152": {
                "slug": "hextech-rocketbelt",
                "known": True,
                "route_identifier": "3152",
                "names": {
                    "en": "Hextech Rocketbelt",
                    "zh-TW": "海克斯科技火箭腰帶",
                    "zh-CN": "海克斯科技火箭腰带",
                    "ja": "ヘクステック ロケットベルト",
                    "ko": "마법공학 로켓 벨트",
                },
            }}},
        )
        target = projection["patches"][0]["sections"][0]["changes"][0]["targets"][0]
        self.assertEqual(target["names"]["zh-tw"], "海克斯科技火箭腰帶")
        self.assertEqual(target["names"]["zh-cn"], "海克斯科技火箭腰带")
        self.assertEqual(target["names"]["ja-jp"], "ヘクステック ロケットベルト")
        self.assertEqual(target["names"]["ko-kr"], "마법공학 로켓 벨트")

    def test_preview_projection_uses_catalog_localized_names_without_exposing_internal_fields(self):
        archive = {
            "status": "fresh",
            "source_patch_label": "pbe-cycle-16.14",
            "events": [event(
                entity_type="item",
                canonical_id="3152",
                slug="hextech-rocketbelt",
                branch="pbe",
                lane="preview",
                source_patch_label="pbe-cycle-16.14",
                names={"en": "Hextech Rocketbelt"},
            )],
        }
        projection = build_preview_projection(
            archive,
            {"champion": set(), "augment": set(), "item": {"3152"}},
            {"item": {"3152": {
                "slug": "hextech-rocketbelt",
                "known": True,
                "route_identifier": "3152",
                "names": {
                    "en": "Hextech Rocketbelt",
                    "zh-TW": "海克斯科技火箭腰帶",
                },
            }}},
        )
        row = projection["events"][0]
        self.assertEqual(row["names"]["zh-TW"], "海克斯科技火箭腰帶")
        self.assertEqual(row["localizedName"], "Hextech Rocketbelt")
        self.assertNotIn("comparison", json.dumps(projection))

    def test_projection_sanitizes_cdragon_markup_from_change_text(self):
        projection = build_patch_notes_projection(
            {
                "current_open_cycle": "26.13",
                "events": [event(
                    fields_changed=["description"],
                    before={"description": "<mainText>Old @Value@</mainText>"},
                    after={"description": "<mainText>New<br>%i:cooldown%</mainText>"},
                )],
            },
            {"patches": []},
        )

        change = projection["patches"][0]["sections"][0]["changes"][0]
        self.assertEqual(change["text"]["en"], "Description: Old — → New —")

    def test_projection_preserves_literal_percent_values_in_descriptions(self):
        projection = build_patch_notes_projection(
            {
                "current_open_cycle": "26.13",
                "events": [event(
                    fields_changed=["description"],
                    before={"description": "35% Attack Speed and 25% Move Speed"},
                    after={"description": "40% Attack Speed and 25% Move Speed"},
                )],
            },
            {"patches": []},
        )

        change = projection["patches"][0]["sections"][0]["changes"][0]
        self.assertEqual(
            change["text"]["en"],
            "Description: 35% Attack Speed and 25% Move Speed → 40% Attack Speed and 25% Move Speed",
        )

    def test_riot_prose_metadata_cannot_create_structural_entity_events(self):
        projection = build_patch_notes_projection(
            {"current_open_cycle": "26.13", "events": []},
            {
                "patches": [{
                    "version": "26.13",
                    "articleTitle": "Patch notes mention Brand + 10 AD",
                    "publishedAt": "2026-07-11T00:00:00Z",
                    "sections": [{"title": "Champions", "changes": [{"subject": "Brand", "text": {"en": "+10 AD"}}]}],
                }],
            },
        )
        current = projection["patches"][0]
        self.assertEqual(current["sections"], [])
        self.assertEqual(current["summary"]["totalChanges"], 0)

    def test_live_projection_marks_a_source_reconciled_preview_as_landed(self):
        live = event()
        projection = build_patch_notes_projection(
            {"current_open_cycle": "26.13", "events": [live]},
            {"patches": []},
            pbe_archive={
                "events": [
                    {
                        **event(branch="pbe", lane="preview"),
                        "lifecycle": "landed",
                        "landed": True,
                    },
                ],
            },
        )

        change = projection["patches"][0]["sections"][0]["changes"][0]
        self.assertTrue(change["landedFromPbe"])

    def test_currently_present_entity_clears_false_removal_tombstone(self):
        projection = build_patch_notes_projection(
            {
                "current_open_cycle": "26.13",
                "events": [{
                    "entity_type": "augment",
                    "canonical_id": "2127",
                    "slug": "forged-by-the-master",
                    "source_patch_label": "26.13",
                    "change_kind": "removed",
                    "fields_changed": [],
                    "before": {},
                    "after": {},
                }],
            },
            {"patches": [{"version": "26.13", "articleTitle": "Patch 26.13"}]},
            known={"champion": set(), "augment": {"forged-by-the-master"}, "item": set()},
            entity_records={"augment": {"2127": {
                "slug": "forged-by-the-master",
                "known": True,
                "route_identifier": "forged-by-the-master",
                "lifecycle": {"state": "active"},
            }}},
        )
        self.assertEqual(projection["patches"][0]["sections"], [])

    def test_preview_projection_is_bounded_and_only_links_live_canonical_entities(self):
        archive = {
            "status": "fresh",
            "source_patch_label": "pbe-cycle-16.14",
            "observed_at": "2026-07-11T01:00:00Z",
            "events": [
                event(branch="pbe", lane="preview", source_patch_label="pbe-cycle-16.14"),
                event(slug="new-champion", canonical_id="999", branch="pbe", lane="preview", source_patch_label="pbe-cycle-16.14"),
                event(slug="old-cycle", source_patch_label="pbe-cycle-16.13"),
                event(slug="landed", source_patch_label="pbe-cycle-16.14", lifecycle="landed", landed=True),
            ],
        }
        known = {
            "champion": {"brand"},
            "augment": set(),
            "item": set(),
        }

        projection = build_preview_projection(archive, known)

        self.assertEqual([row["slug"] for row in projection["events"]], ["brand", "new-champion"])
        self.assertEqual(projection["events"][0]["href"], "/champions/brand")
        self.assertNotIn("href", projection["events"][1])
        self.assertNotIn("lifecycle", json.dumps(projection))
        self.assertNotIn("comparison", json.dumps(projection))


if __name__ == "__main__":
    unittest.main()
