#!/usr/bin/env python3
"""Produce a deterministic candidate DecisionModelConfig from training data."""

from __future__ import annotations

import argparse
import copy
import json
from collections import defaultdict
from fractions import Fraction
from pathlib import Path

import data_source
import package_model

ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = Path(__file__).resolve().parent
DEFAULT_TRAINING = MODEL_DIR / "dist" / "training-data.json"
DEFAULT_OUTPUT = MODEL_DIR / "dist" / "candidate-model-config.json"
DEFAULT_AUGMENT_METADATA = ROOT / "data/internal/augments.json"
ARCHETYPE_BY_TYPE = {
    "quest": "scaling",
    "ability": "immediate",
    "standalone": "neutral",
}


def load_augment_archetypes(path: Path) -> dict[str, str]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {
        augment["slug"]: ARCHETYPE_BY_TYPE.get(augment.get("type"), "neutral")
        for augment in payload["augments"]
    }


def group_rates(
    participants: list[dict],
    key_values,
) -> dict[object, Fraction]:
    outcomes: dict[object, list[int]] = defaultdict(lambda: [0, 0])
    for participant in participants:
        for key in key_values(participant):
            outcomes[key][0] += int(participant["won"])
            outcomes[key][1] += 1
    return {
        key: Fraction(wins, count)
        for key, (wins, count) in sorted(outcomes.items(), key=lambda entry: str(entry[0]))
    }


def percentile(values: list[Fraction], fraction: Fraction) -> Fraction:
    if not values:
        return Fraction(0)
    ordered = sorted(values)
    position = fraction * (len(ordered) - 1)
    lower = position.numerator // position.denominator
    upper = min(lower + 1, len(ordered) - 1)
    remainder = position - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * remainder


def bounded_integer(value: Fraction, active: int, maximum_delta: int) -> int:
    rounded = round(float(value))
    return max(active - maximum_delta, min(active + maximum_delta, rounded))


def positive_association_lift(
    association_rates: dict[tuple[str, str], Fraction],
    champion_rates: dict[str, Fraction],
) -> Fraction:
    lifts = [
        rate - champion_rates[champion]
        for (champion, _value), rate in association_rates.items()
        if rate > champion_rates[champion]
    ]
    return sum(lifts, Fraction(0)) / len(lifts) if lifts else Fraction(0)


def calibrate_final_state(candidate: dict, participants: list[dict]) -> None:
    augment_rates = group_rates(
        participants,
        lambda participant: participant["augment_slugs"],
    )
    champion_rates = group_rates(
        participants,
        lambda participant: [participant["champion_slug"]],
    )
    champion_augment_rates = group_rates(
        participants,
        lambda participant: [
            (participant["champion_slug"], augment)
            for augment in participant["augment_slugs"]
        ],
    )
    champion_item_rates = group_rates(
        participants,
        lambda participant: [
            (participant["champion_slug"], item)
            for item in participant["item_ids"]
        ],
    )

    active_minimum, active_maximum = candidate["priorClamp"]
    percentages = [rate * 100 for rate in augment_rates.values()]
    candidate["priorClamp"] = [
        bounded_integer(percentile(percentages, Fraction(1, 10)), active_minimum, 2),
        bounded_integer(percentile(percentages, Fraction(9, 10)), active_maximum, 2),
    ]

    augment_lift = positive_association_lift(champion_augment_rates, champion_rates)
    synergy_delta = round(min(0.2, float(augment_lift)), 3)
    for mode in ("competitive", "exploration"):
        candidate["modeMultipliers"][mode]["synergy"] = round(
            candidate["modeMultipliers"][mode]["synergy"] + synergy_delta,
            3,
        )

    item_lift = positive_association_lift(champion_item_rates, champion_rates)
    item_delta = round(min(2, float(item_lift * 4)))
    candidate["itemValue"]["currentSynergy"] += item_delta
    candidate["itemValue"]["plannedSynergy"] = round(
        candidate["itemValue"]["currentSynergy"] / 2
    )


def calibrate_round_effects(
    candidate: dict,
    contributor_choices: list[dict],
    augment_archetypes: dict[str, str],
) -> None:
    counts: dict[str, dict[int, int]] = {
        archetype: {round_number: 0 for round_number in range(1, 5)}
        for archetype in ("scaling", "immediate", "neutral")
    }
    for choice in contributor_choices:
        selected = choice["selected_augment_slug"]
        if not selected:
            continue
        archetype = augment_archetypes.get(selected, "neutral")
        counts[archetype][choice["round"]] += 1

    for archetype, by_round in counts.items():
        total = sum(by_round.values())
        if total == 0:
            continue
        for round_number, count in by_round.items():
            share = Fraction(count, total)
            delta = max(-2, min(2, round(float((share - Fraction(1, 4)) * 4))))
            key = str(round_number)
            candidate["roundValue"][archetype][key] += delta


def calibrate_config(
    *,
    training: dict,
    active: dict,
    model_version: str,
    augment_archetypes: dict[str, str],
) -> dict:
    candidate = copy.deepcopy(active)
    candidate["modelVersion"] = model_version
    calibrate_final_state(candidate, training["participants"])
    calibrate_round_effects(
        candidate,
        training["contributor_round_choices"],
        augment_archetypes,
    )
    return candidate


def write_config(path: Path, config: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data_source.canonical_json_bytes(config) + b"\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--training", type=Path, default=DEFAULT_TRAINING)
    parser.add_argument("--active-config", type=Path)
    parser.add_argument("--augment-metadata", type=Path, default=DEFAULT_AUGMENT_METADATA)
    parser.add_argument("--model-version", required=True)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    active = (
        json.loads(args.active_config.read_text(encoding="utf-8"))
        if args.active_config
        else package_model.load_current_model_config()
    )
    candidate = calibrate_config(
        training=json.loads(args.training.read_text(encoding="utf-8")),
        active=active,
        model_version=args.model_version,
        augment_archetypes=load_augment_archetypes(args.augment_metadata),
    )
    write_config(args.output, candidate)
    print(args.output)


if __name__ == "__main__":
    main()
