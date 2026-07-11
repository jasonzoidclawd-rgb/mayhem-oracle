#!/usr/bin/env python3
"""Fail if production browser artifacts contain internal patch/PBE lineage data."""

from __future__ import annotations

import argparse
from pathlib import Path


FORBIDDEN_MARKERS = (
    b"data/internal/",
    b"patch-events.json",
    b"pbe-preview-history",
    b"cdragon-augment-",
    b"cdragon-champion-",
    b"cdragon-item-",
    b"first_seen_cycle",
    b"last_seen_cycle",
    b"observed_cycles",
    b"landed_at",
    b"comparison",
    b"scoreBreakdown",
    b"oracleScore",
    b"modelWeights",
)


def verify_bundle_boundary(root: Path) -> dict[str, int]:
    static_dir = root / ".next" / "static"
    route_dir = root / ".next" / "server" / "app" / "[locale]" / "patch-notes"
    if not static_dir.is_dir() or not route_dir.is_dir():
        raise ValueError("production build artifacts are missing; run npm run build first")

    scanned = 0
    leaks: list[str] = []
    for directory in (static_dir, route_dir):
        for path in directory.rglob("*"):
            if not path.is_file():
                continue
            scanned += 1
            payload = path.read_bytes()
            for marker in FORBIDDEN_MARKERS:
                if marker in payload:
                    leaks.append(f"{path.relative_to(root)} contains {marker.decode()}")
    if leaks:
        raise ValueError("production public-boundary violation: " + "; ".join(sorted(leaks)))
    return {"scanned_files": scanned, "leaks": 0}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()
    print(verify_bundle_boundary(args.root))


if __name__ == "__main__":
    main()
