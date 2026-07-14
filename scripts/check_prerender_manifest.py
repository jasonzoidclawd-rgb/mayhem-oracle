#!/usr/bin/env python3
"""Assert that every canonical champion detail URL was prerendered by Next.js."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CHAMPIONS_PATH = ROOT / "public" / "data" / "champions.json"
ROUTING_PATH = ROOT / "src" / "i18n" / "routing.ts"
MANIFEST_PATH = ROOT / ".next" / "prerender-manifest.json"
CHAMPION_ROUTE_TEMPLATE = "/[locale]/champions/[slug]"


class PrerenderManifestError(RuntimeError):
    pass


def load_locales(path: Path) -> list[str]:
    source = path.read_text(encoding="utf-8")
    match = re.search(r"locales\s*:\s*\[([^\]]+)\]", source)
    if not match:
        raise PrerenderManifestError(f"could not derive locales from {path}")
    locales = re.findall(r'["\']([^"\']+)["\']', match.group(1))
    if not locales or len(locales) != len(set(locales)):
        raise PrerenderManifestError(f"invalid or duplicate locale list in {path}")
    return locales


def load_champion_slugs(path: Path) -> list[str]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = payload.get("champions") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise PrerenderManifestError(f"champion catalog has no champions list: {path}")
    slugs = [row.get("slug") for row in rows if isinstance(row, dict)]
    if any(not isinstance(slug, str) or not slug for slug in slugs):
        raise PrerenderManifestError(f"champion catalog contains an invalid slug: {path}")
    if len(slugs) != len(set(slugs)):
        raise PrerenderManifestError(f"champion catalog contains duplicate slugs: {path}")
    return slugs


def verify_prerender_manifest(
    manifest: dict[str, Any],
    champion_slugs: list[str],
    locales: list[str],
) -> dict[str, int]:
    expected = {
        f"/{locale}/champions/{slug}"
        for locale in locales
        for slug in champion_slugs
    }
    route_map = manifest.get("routes")
    if not isinstance(route_map, dict):
        raise PrerenderManifestError("prerender manifest has no routes object")
    actual = {
        route
        for route in route_map
        if re.fullmatch(r"/[^/]+/champions/[^/]+", route)
    }
    missing = sorted(expected - actual)
    unexpected = sorted(actual - expected)
    if missing or unexpected:
        details = []
        if missing:
            details.append(f"missing {len(missing)} route(s), first: {missing[:5]}")
        if unexpected:
            details.append(f"unexpected {len(unexpected)} route(s), first: {unexpected[:5]}")
        raise PrerenderManifestError("; ".join(details))

    dynamic_routes = manifest.get("dynamicRoutes")
    if not isinstance(dynamic_routes, dict):
        raise PrerenderManifestError("prerender manifest has no dynamicRoutes object")
    route_contract = dynamic_routes.get(CHAMPION_ROUTE_TEMPLATE)
    if not isinstance(route_contract, dict):
        raise PrerenderManifestError(
            f"{CHAMPION_ROUTE_TEMPLATE} is absent from prerender dynamic route contracts"
        )
    if route_contract.get("fallback") is not False:
        raise PrerenderManifestError(
            f"{CHAMPION_ROUTE_TEMPLATE} must retain fallback=false (dynamicParams=false)"
        )

    return {
        "champion_count": len(champion_slugs),
        "locale_count": len(locales),
        "expected_champion_prerender_count": len(expected),
        "actual_champion_prerender_count": len(actual),
        "total_prerender_route_count": len(route_map),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=MANIFEST_PATH)
    parser.add_argument("--champions", type=Path, default=CHAMPIONS_PATH)
    parser.add_argument("--routing", type=Path, default=ROUTING_PATH)
    args = parser.parse_args()
    try:
        summary = verify_prerender_manifest(
            json.loads(args.manifest.read_text(encoding="utf-8")),
            load_champion_slugs(args.champions),
            load_locales(args.routing),
        )
    except (OSError, json.JSONDecodeError, PrerenderManifestError) as exc:
        print(f"champion prerender invariant FAILED: {exc}")
        return 1
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
