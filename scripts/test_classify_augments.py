#!/usr/bin/env python3
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import classify_augments as classifier
from classify_augments import (
    apply_deterministic_fallback,
    derive_deterministic_tags,
    should_use_llm,
    validate_added_coverage,
)


class DeterministicAugmentClassifierTests(unittest.TestCase):
    def test_derives_tags_from_existing_description(self):
        augment = {
            "slug": "pursuit-of-haste",
            "name": "Pursuit of Haste",
            "type": "ability",
            "wikiDescription": (
                "Hit enemy champions with your chosen ability. "
                "Reward: Gain Ability Haste."
            ),
        }

        self.assertEqual(derive_deterministic_tags(augment), ["ability", "haste"])

    def test_reuses_curated_few_shot_tags(self):
        augment = {
            "slug": "tooth-fairy",
            "name": "Tooth Fairy",
            "type": "quest",
            "wikiDescription": "Bursting enemies drops Teeth.",
        }

        self.assertEqual(derive_deterministic_tags(augment), ["ability", "attack"])

    def test_does_not_invent_tags_for_economy_augment(self):
        augment = {
            "slug": "high-roller",
            "name": "High Roller",
            "type": "standalone",
            "wikiDescription": "Nearby enemies have a chance to drop Stat Anvils.",
        }

        self.assertEqual(derive_deterministic_tags(augment), [])

    def test_does_not_treat_a_generic_ability_mention_as_kit_synergy(self):
        augment = {
            "slug": "stackosaurusrex",
            "name": "Stackosaurusrex",
            "type": "standalone",
            "wikiDescription": (
                "When you gain permanent Stacks of an Ability, Augment, or Item "
                "gain more."
            ),
        }

        self.assertEqual(derive_deterministic_tags(augment), [])

    def test_default_groq_requires_a_real_key(self):
        self.assertFalse(should_use_llm("", "https://api.groq.com/openai/v1/chat/completions"))
        self.assertTrue(should_use_llm("real-key", "https://api.groq.com/openai/v1/chat/completions"))
        self.assertTrue(should_use_llm("", "http://127.0.0.1:4000/v1/chat/completions"))

    def test_dry_run_does_not_require_a_groq_key(self):
        data = {
            "augments": [
                {
                    "slug": "unclassified",
                    "name": "Unclassified",
                    "rarity": "silver",
                    "type": "standalone",
                    "wikiDescription": "",
                    "kit_tags": [],
                    "flags": {"lifecycle": "active"},
                }
            ]
        }

        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "augments.json"
            target.write_text(json.dumps(data), encoding="utf-8")
            output = io.StringIO()
            with (
                patch.object(classifier, "AUGMENTS_PATH", target),
                patch.object(
                    classifier,
                    "LITELLM_URL",
                    "https://api.groq.com/openai/v1/chat/completions",
                ),
                patch.dict(os.environ, {"GROQ_API_KEY": ""}),
                patch.object(
                    sys,
                    "argv",
                    ["classify_augments.py", "--skip-classified", "--dry-run"],
                ),
                contextlib.redirect_stdout(output),
            ):
                classifier.main()

        self.assertIn("--- DRY RUN: first batch prompt ---", output.getvalue())

    def test_strict_no_key_mode_refuses_to_write_unresolved_augments(self):
        data = {
            "augments": [
                {
                    "slug": f"tagged-{index}",
                    "name": f"Tagged {index}",
                    "rarity": "silver",
                    "type": "standalone",
                    "wikiDescription": "",
                    "kit_tags": ["tank"],
                    "flags": {"lifecycle": "added"},
                }
                for index in range(4)
            ] + [
                {
                    "slug": "unresolved",
                    "name": "Unresolved",
                    "rarity": "silver",
                    "type": "standalone",
                    "wikiDescription": "",
                    "kit_tags": [],
                    "flags": {"lifecycle": "added"},
                }
            ]
        }

        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "augments.json"
            original = json.dumps(data)
            target.write_text(original, encoding="utf-8")
            with (
                patch.object(classifier, "AUGMENTS_PATH", target),
                patch.object(
                    classifier,
                    "LITELLM_URL",
                    "https://api.groq.com/openai/v1/chat/completions",
                ),
                patch.dict(os.environ, {"GROQ_API_KEY": ""}),
                patch.object(sys, "argv", ["classify_augments.py", "--skip-classified"]),
                contextlib.redirect_stdout(io.StringIO()),
                self.assertRaises(SystemExit) as raised,
            ):
                classifier.main()

            self.assertEqual(raised.exception.code, 1)
            self.assertEqual(target.read_text(encoding="utf-8"), original)

    def test_allow_partial_no_key_mode_writes_deterministic_classifications(self):
        data = {
            "augments": [
                {
                    "slug": f"tagged-{index}",
                    "name": f"Tagged {index}",
                    "rarity": "silver",
                    "type": "standalone",
                    "wikiDescription": "",
                    "kit_tags": ["tank"],
                    "flags": {"lifecycle": "added"},
                }
                for index in range(4)
            ] + [
                {
                    "slug": "pursuit-of-haste",
                    "name": "Pursuit of Haste",
                    "rarity": "gold",
                    "type": "ability",
                    "wikiDescription": "Your chosen ability gains Ability Haste.",
                    "kit_tags": [],
                    "flags": {"lifecycle": "added"},
                }
            ]
        }

        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "augments.json"
            target.write_text(json.dumps(data), encoding="utf-8")
            with (
                patch.object(classifier, "AUGMENTS_PATH", target),
                patch.object(
                    classifier,
                    "LITELLM_URL",
                    "https://api.groq.com/openai/v1/chat/completions",
                ),
                patch.dict(os.environ, {"GROQ_API_KEY": ""}),
                patch.object(
                    sys,
                    "argv",
                    [
                        "classify_augments.py",
                        "--skip-classified",
                        "--allow-partial",
                    ],
                ),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                classifier.main()

            written = json.loads(target.read_text(encoding="utf-8"))
            self.assertEqual(
                written["augments"][-1]["kit_tags"],
                ["ability", "haste"],
            )

    def test_fallback_only_fills_added_augments_without_valid_tags(self):
        augments = [
            {
                "slug": "pursuit-of-haste",
                "name": "Pursuit of Haste",
                "type": "ability",
                "wikiDescription": "Your chosen ability gains Ability Haste.",
                "kit_tags": [],
                "flags": {"lifecycle": "added"},
            },
            {
                "slug": "existing",
                "name": "Existing",
                "type": "standalone",
                "wikiDescription": "Gain Ability Haste.",
                "kit_tags": ["tank"],
                "flags": {"lifecycle": "added"},
            },
            {
                "slug": "active",
                "name": "Active",
                "type": "ability",
                "wikiDescription": "Your chosen ability gains Ability Haste.",
                "kit_tags": [],
                "flags": {"lifecycle": "active"},
            },
        ]

        self.assertEqual(apply_deterministic_fallback(augments), 1)
        self.assertEqual(augments[0]["kit_tags"], ["ability", "haste"])
        self.assertEqual(augments[1]["kit_tags"], ["tank"])
        self.assertEqual(augments[2]["kit_tags"], [])

    def test_added_coverage_gate_rejects_incomplete_fallback(self):
        augments = [
            {"slug": "tagged", "kit_tags": ["ability"], "flags": {"lifecycle": "added"}},
            {"slug": "missing", "kit_tags": [], "flags": {"lifecycle": "added"}},
        ]

        with self.assertRaisesRegex(RuntimeError, "1/2"):
            validate_added_coverage(augments, minimum=0.8)


if __name__ == "__main__":
    unittest.main()
