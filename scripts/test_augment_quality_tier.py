import random
import unittest

from augment_quality_tier import MIN_GLOBAL_AUGMENT_TIER_GAMES, derive_quality_tiers


def catalog(ids):
    return {
        "patch": "26.13",
        "augments": [
            {
                "augmentId": augment_id,
                "slug": augment_id.lower(),
                "patch": "26.13",
                "flags": {"lifecycle": "active"},
                "availability": {"status": "confirmed_live"},
            }
            for augment_id in ids
        ],
    }


def feed(ids, *, games=MIN_GLOBAL_AUGMENT_TIER_GAMES, patch="26.13", rates=None):
    return {
        "patch": patch,
        "win_rates": {augment_id: (rates or {}).get(augment_id, 50.0) for augment_id in ids},
        "sample_counts": {augment_id: games for augment_id in ids},
    }


class AugmentQualityTierTests(unittest.TestCase):
    def test_uses_existing_grade_band_population_contract_with_ceil_boundaries(self):
        ids = [f"A{i:03d}" for i in range(20)]
        rates = {augment_id: 100 - i for i, augment_id in enumerate(ids)}
        tiers, summary = derive_quality_tiers(
            catalog=catalog(ids),
            feed=feed(ids, rates=rates),
            current_patch="26.13",
        )
        self.assertEqual(summary["eligibleAugments"], 20)
        self.assertEqual(summary["tiers"], {"S+": 2, "S": 4, "A": 6, "B": 5, "C": 3})
        self.assertEqual(tiers["A000"], "S+")
        self.assertEqual(tiers["A001"], "S+")
        self.assertEqual(tiers["A002"], "S")
        self.assertEqual(tiers["A005"], "S")
        self.assertEqual(tiers["A006"], "A")
        self.assertEqual(tiers["A011"], "A")
        self.assertEqual(tiers["A012"], "B")
        self.assertEqual(tiers["A016"], "B")
        self.assertEqual(tiers["A017"], "C")

    def test_small_population_rounds_up_from_the_top_and_has_exclusive_boundaries(self):
        ids = [f"A{i}" for i in range(1, 6)]
        tiers, summary = derive_quality_tiers(
            catalog=catalog(ids),
            feed=feed(ids, rates={augment_id: 100 - i for i, augment_id in enumerate(ids)}),
            current_patch="26.13",
        )
        self.assertEqual(summary["tiers"], {"S+": 1, "S": 1, "A": 1, "B": 2, "C": 0})
        self.assertEqual([tiers[augment_id] for augment_id in ids], ["S+", "S", "A", "B", "B"])

    def test_ties_use_canonical_id_and_shuffled_input_is_identical(self):
        ids = ["B", "A", "C", "D", "E"]
        rates = {augment_id: 50.0 for augment_id in ids}
        baseline, _ = derive_quality_tiers(catalog=catalog(ids), feed=feed(ids, rates=rates), current_patch="26.13")
        shuffled = ids[:]
        random.Random(42).shuffle(shuffled)
        rerun, _ = derive_quality_tiers(catalog=catalog(shuffled), feed=feed(shuffled, rates=rates), current_patch="26.13")
        self.assertEqual(baseline, rerun)
        self.assertEqual(baseline["A"], "S+")
        self.assertEqual(baseline["B"], "S")

        reversed_order, _ = derive_quality_tiers(
            catalog=catalog(list(reversed(ids))),
            feed=feed(list(reversed(ids)), rates=rates),
            current_patch="26.13",
        )
        self.assertEqual(baseline, reversed_order)

    def test_missing_and_boundary_sample_counts_are_fail_closed(self):
        ids = ["A", "B", "C"]
        current = feed(ids)
        current["sample_counts"]["A"] = 999
        current["sample_counts"].pop("B")
        current["sample_counts"]["C"] = 1000
        tiers, summary = derive_quality_tiers(catalog=catalog(ids), feed=current, current_patch="26.13")
        self.assertIsNone(tiers["A"])
        self.assertIsNone(tiers["B"])
        self.assertIsNotNone(tiers["C"])
        self.assertEqual(summary["eligibleAugments"], 1)
        self.assertEqual(summary["ineligibleReasons"]["insufficient-sample-count"], 1)
        self.assertEqual(summary["ineligibleReasons"]["missing-or-invalid-sample-count"], 1)

    def test_current_patch_feed_without_any_sample_count_ranks_real_rates(self):
        ids = ["A", "B", "C"]
        current = feed(ids, rates={"A": 53.0, "B": 51.0, "C": 49.0})
        current.pop("sample_counts")
        tiers, summary = derive_quality_tiers(catalog=catalog(ids), feed=current, current_patch="26.13")
        self.assertEqual([tiers[augment_id] for augment_id in ids], ["S+", "A", "B"])
        self.assertEqual(summary["eligibleAugments"], 3)
        self.assertEqual(summary["eligibilityPolicy"], "current-patch-global-rank")

    def test_stale_patch_and_duplicate_identity_are_neutral(self):
        duplicate_catalog = catalog(["A", "B"])
        duplicate_catalog["augments"].append(dict(duplicate_catalog["augments"][0]))
        tiers, summary = derive_quality_tiers(
            catalog=duplicate_catalog,
            identity_catalog=duplicate_catalog,
            feed=feed(["A", "B"], patch="26.12"),
            current_patch="26.13",
        )
        self.assertEqual(tiers, {"A": None, "B": None})
        self.assertEqual(summary["eligibleAugments"], 0)
        self.assertGreaterEqual(summary["ineligibleReasons"].get("duplicate-canonical-identity", 0), 1)
        self.assertGreaterEqual(summary["ineligibleReasons"].get("stale-or-missing-feed-patch", 0), 1)


if __name__ == "__main__":
    unittest.main()
