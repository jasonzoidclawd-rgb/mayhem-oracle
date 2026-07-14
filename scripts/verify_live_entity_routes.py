#!/usr/bin/env python3
"""Verify live entity detail routes return real pages and hard 404s."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List


ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DATA_DIR = ROOT / "public" / "data"
DEFAULT_BASE_URL = "https://wasfun.lol"
CHECK_LOCALES = ("en", "zh-TW")
USER_AGENT = "mayhem-oracle-live-entity-routes/1.0"


@dataclass(frozen=True)
class EntityTarget:
    kind: str
    path: str
    name: str


@dataclass(frozen=True)
class FetchResponse:
    url: str
    status: int
    body: str
    error: str | None = None


@dataclass(frozen=True)
class RouteCheck:
    kind: str
    url: str
    expected_status: int
    passed: bool
    failures: list[str]


UNKNOWN_PATHS = {
    "champion": "/champions/zzz-not-real",
    "augment": "/augments/zzz-not-real",
    "item": "/items/9999999",
}


def normalize_base_url(value: str) -> str:
    normalized = value.strip().rstrip("/")
    parsed = urllib.parse.urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("base URL must start with http:// or https://")
    return normalized


def localized_path(path: str, locale: str) -> str:
    return path if locale == "en" else f"/{locale}{path}"


def absolute_url(base_url: str, path: str) -> str:
    return f"{base_url}{path if path.startswith('/') else '/' + path}"


def fetch_url(url: str, timeout: int = 20) -> FetchResponse:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            body = response.read().decode(charset, errors="replace")
            return FetchResponse(url, response.getcode(), body)
    except urllib.error.HTTPError as exc:
        charset = exc.headers.get_content_charset() if exc.headers else None
        body = exc.read().decode(charset or "utf-8", errors="replace")
        return FetchResponse(url, exc.code, body, str(exc))
    except urllib.error.URLError as exc:
        return FetchResponse(url, 0, "", str(exc.reason))


def load_public_targets(data_dir: Path = PUBLIC_DATA_DIR) -> Dict[str, EntityTarget]:
    champions = json.loads((data_dir / "champions.json").read_text(encoding="utf-8"))["champions"]
    locke = next((champion for champion in champions if champion.get("slug") == "locke"), None)
    if not locke:
        raise ValueError("public champion data must contain Locke for the live probe")

    augments = json.loads((data_dir / "augments.json").read_text(encoding="utf-8"))["augments"]
    augment = next(
        (
            entry
            for entry in augments
            if entry.get("flags", {}).get("lifecycle") != "removed"
        ),
        None,
    )
    if not augment:
        raise ValueError("public augment data must contain an active augment")

    items = json.loads((data_dir / "items.json").read_text(encoding="utf-8"))
    item = (items.get("mayhemExclusive") or [None])[0]
    if item:
        item_identifier = item.get("slug")
        item_name = item.get("name")
    else:
        item = next((entry for entry in items.get("items", []) if entry.get("id") is not None), None)
        item_identifier = str(item["id"]) if item else None
        item_name = item.get("name") if item else None
    if not item_identifier or not item_name:
        raise ValueError("public item data must contain a routable item")

    return {
        "champion": EntityTarget("champion", "/champions/locke", locke["name"]),
        "augment": EntityTarget(
            "augment",
            f"/augments/{augment['slug']}",
            augment["name"],
        ),
        "item": EntityTarget("item", f"/items/{item_identifier}", item_name),
    }


def check_response(
    kind: str,
    url: str,
    response: FetchResponse,
    expected_status: int,
    expected_name: str | None = None,
) -> RouteCheck:
    failures: List[str] = []
    if response.status != expected_status:
        failures.append(
            f"expected HTTP {expected_status}, got {response.status}"
            + (f": {response.error}" if response.error else "")
        )
    if expected_name and expected_name.casefold() not in response.body.casefold():
        failures.append(f"expected entity name {expected_name!r} in response body")
    return RouteCheck(kind, url, expected_status, not failures, failures)


def run_checks(
    base_url: str,
    targets: Dict[str, EntityTarget],
    fetcher: Callable[[str], FetchResponse] = fetch_url,
) -> List[RouteCheck]:
    base = normalize_base_url(base_url)
    checks: List[RouteCheck] = []
    for kind in ("champion", "augment", "item"):
        if kind not in targets:
            continue
        target = targets[kind]
        known_url = absolute_url(base, target.path)
        checks.append(
            check_response(
                kind,
                known_url,
                fetcher(known_url),
                expected_status=200,
                expected_name=target.name,
            )
        )
        for locale in CHECK_LOCALES:
            unknown_path = localized_path(UNKNOWN_PATHS[kind], locale)
            unknown_url = absolute_url(base, unknown_path)
            checks.append(
                check_response(
                    f"{kind}:unknown",
                    unknown_url,
                    fetcher(unknown_url),
                    expected_status=404,
                )
            )
    return checks


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--base-url",
        default=os.getenv("BASE_URL", DEFAULT_BASE_URL),
    )
    parser.add_argument("--data-dir", type=Path, default=PUBLIC_DATA_DIR)
    args = parser.parse_args()

    try:
        targets = load_public_targets(args.data_dir)
        checks = run_checks(args.base_url, targets)
    except Exception as exc:
        print(f"live entity route probe unavailable: {exc}", file=sys.stderr)
        raise SystemExit(1)

    for check in checks:
        if check.passed:
            print(f"PASS {check.kind} {check.url} HTTP {check.expected_status}")
        else:
            for failure in check.failures:
                print(f"FAIL {check.kind} {check.url}: {failure}", file=sys.stderr)

    if any(not check.passed for check in checks):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
