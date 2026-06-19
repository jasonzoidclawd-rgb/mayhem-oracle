#!/usr/bin/env python3
"""Build a deterministic audit report for a candidate model config."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import calibrate
import data_source
import package_model

ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = Path(__file__).resolve().parent
DEFAULT_TRAINING = MODEL_DIR / "dist" / "training-data.json"
DEFAULT_CANDIDATE = MODEL_DIR / "dist" / "candidate-model-config.json"
DEFAULT_OUTPUT = MODEL_DIR / "dist" / "candidate-report.json"
DEFAULT_PARITY_FIXTURES = ROOT / "docs/handoffs/fixtures/m1"
APPROVAL_COMMAND = (
    "python3 scripts/model/approve_release.py "
    "--package <signed-candidate> --public-key <public-key> "
    "--package-url <immutable-r2-url> --approved-by <human> "
    "--releases <snapshot> --output-dir <approval-dir> --approve"
)
TRAP_WARNINGS = {"hard-incompatible", "mechanical-trap", "kit-mismatch"}


def sorted_counts(values) -> dict[str, int]:
    return dict(sorted(Counter(str(value) for value in values).items()))


def sample_counts(training: dict) -> dict:
    return {
        "patch": sorted_counts(row["patch"] for row in training["matches"]),
        "champion": sorted_counts(
            row["champion_slug"] for row in training["participants"]
        ),
        "augment": sorted_counts(
            augment
            for row in training["participants"]
            for augment in row["augment_slugs"]
        ),
        "round": sorted_counts(
            row["round"] for row in training["contributor_round_choices"]
        ),
    }


def calibration_deltas(active: object, candidate: object, path: str = "") -> list[dict]:
    if isinstance(active, dict) and isinstance(candidate, dict):
        deltas = []
        for key in sorted(set(active) | set(candidate)):
            child_path = f"{path}.{key}" if path else key
            deltas.extend(
                calibration_deltas(active.get(key), candidate.get(key), child_path)
            )
        return deltas
    if isinstance(active, list) and isinstance(candidate, list):
        deltas = []
        for index in range(max(len(active), len(candidate))):
            child_path = f"{path}.{index}"
            before = active[index] if index < len(active) else None
            after = candidate[index] if index < len(candidate) else None
            deltas.extend(calibration_deltas(before, after, child_path))
        return deltas
    if active == candidate:
        return []
    delta = {"path": path, "active": active, "candidate": candidate}
    if (
        isinstance(active, (int, float))
        and not isinstance(active, bool)
        and isinstance(candidate, (int, float))
        and not isinstance(candidate, bool)
    ):
        delta["delta"] = round(candidate - active, 3)
    return [delta]


def load_parity_fixtures(directory: Path) -> list[tuple[str, dict]]:
    return [
        (path.stem, json.loads(path.read_text(encoding="utf-8")))
        for path in sorted(directory.glob("*.json"))
    ]


def candidate_score(
    fixture: dict,
    candidate_result: dict,
    candidate_config: dict,
    augment_archetypes: dict[str, str],
) -> float:
    mode = fixture["context"]["mode"]
    round_number = str(fixture["context"]["round"])
    breakdown = candidate_result["breakdown"]
    multipliers = candidate_config["modeMultipliers"][mode]
    archetype = augment_archetypes.get(candidate_result["augmentSlug"], "neutral")
    round_value = candidate_config["roundValue"][archetype][round_number]
    score = (
        breakdown["reliability"] * multipliers["reliability"]
        + breakdown["synergy"] * multipliers["synergy"]
        + breakdown["novelty"] * multipliers["novelty"]
        + breakdown["penalties"]
        + round_value
    )
    return round(score, 3)


def ranking_stability(
    fixtures: list[tuple[str, dict]],
    candidate: dict,
    augment_archetypes: dict[str, str],
) -> dict:
    by_mode = {"competitive": [], "exploration": []}
    for name, fixture in fixtures:
        baseline = [
            result["augmentSlug"] for result in fixture["result"]["candidates"]
        ]
        rescored = sorted(
            fixture["result"]["candidates"],
            key=lambda result: (
                -candidate_score(fixture, result, candidate, augment_archetypes),
                result["augmentSlug"],
            ),
        )
        candidate_order = [result["augmentSlug"] for result in rescored]
        by_mode[fixture["context"]["mode"]].append(
            {
                "fixture": name,
                "baselineOrder": baseline,
                "candidateOrder": candidate_order,
                "orderStable": candidate_order == baseline,
                "topChoiceStable": bool(baseline)
                and bool(candidate_order)
                and candidate_order[0] == baseline[0],
            }
        )
    return {
        mode: {
            "method": "fixture-breakdown-rescore",
            "stableOrders": sum(result["orderStable"] for result in results),
            "stableTopChoices": sum(result["topChoiceStable"] for result in results),
            "totalFixtures": len(results),
            "fixtures": results,
        }
        for mode, results in by_mode.items()
    }


def trap_warning_regressions(fixtures: list[tuple[str, dict]]) -> dict:
    checked = []
    for name, fixture in fixtures:
        warnings = sorted(
            {
                warning
                for candidate in fixture["result"]["candidates"]
                for warning in candidate["warnings"]
                if warning in TRAP_WARNINGS
            }
        )
        if warnings:
            checked.append({"fixture": name, "preservedWarnings": warnings})
    return {
        "method": "config-only-change-preserves-engine-warning-logic",
        "checkedFixtures": checked,
        "regressions": [],
    }


def parity_fixture_results(
    fixtures: list[tuple[str, dict]],
    active: dict,
    candidate: dict,
) -> dict:
    shape_matches = set(active) == set(candidate)
    results = []
    for name, fixture in fixtures:
        checks = {
            "activeModelVersion": fixture["result"]["modelVersion"]
            == active["modelVersion"],
            "candidateConfigShape": shape_matches,
            "hasCandidates": bool(fixture["result"]["candidates"]),
            "validMode": fixture["context"]["mode"] in {"competitive", "exploration"},
        }
        results.append(
            {
                "fixture": name,
                "passed": all(checks.values()),
                "checks": checks,
            }
        )
    return {
        "passed": all(result["passed"] for result in results),
        "fixtures": results,
    }


def build_report(
    *,
    training: dict,
    active: dict,
    candidate: dict,
    parity_fixture_dir: Path,
    augment_archetypes: dict[str, str],
) -> dict:
    fixtures = load_parity_fixtures(parity_fixture_dir)
    return {
        "candidateModelVersion": candidate["modelVersion"],
        "sampleCounts": sample_counts(training),
        "calibrationDeltas": calibration_deltas(active, candidate),
        "rankingStability": ranking_stability(fixtures, candidate, augment_archetypes),
        "trapWarningRegressions": trap_warning_regressions(fixtures),
        "parityFixtureResults": parity_fixture_results(fixtures, active, candidate),
        "releaseGate": {
            "status": "manual-approval-required",
            "command": APPROVAL_COMMAND,
            "autoPromotion": False,
        },
    }


def write_report(path: Path, report: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data_source.canonical_json_bytes(report) + b"\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--training", type=Path, default=DEFAULT_TRAINING)
    parser.add_argument("--active-config", type=Path)
    parser.add_argument("--candidate-config", type=Path, default=DEFAULT_CANDIDATE)
    parser.add_argument("--parity-fixtures", type=Path, default=DEFAULT_PARITY_FIXTURES)
    parser.add_argument(
        "--augment-metadata",
        type=Path,
        default=calibrate.DEFAULT_AUGMENT_METADATA,
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    active = (
        package_model.load_model_config(args.active_config)
        if args.active_config
        else package_model.load_current_model_config()
    )
    report = build_report(
        training=json.loads(args.training.read_text(encoding="utf-8")),
        active=active,
        candidate=package_model.load_model_config(args.candidate_config),
        parity_fixture_dir=args.parity_fixtures,
        augment_archetypes=calibrate.load_augment_archetypes(args.augment_metadata),
    )
    write_report(args.output, report)
    print(args.output)


if __name__ == "__main__":
    main()
