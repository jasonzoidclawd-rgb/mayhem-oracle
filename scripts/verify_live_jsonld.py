#!/usr/bin/env python3
"""Verify live detail-page JSON-LD stays public, typed, and locale-correct.

Parses only <script type="application/ld+json"> blocks (whole-page grep is not
a valid moat check) for one augment, item, and champion page per locale:

- graph node types are exactly [WebPage, BreadcrumbList, <entity type>]
- WebPage.inLanguage matches the page locale
- the breadcrumb home keeps the locale prefix
- no forbidden internal/member/scoring terms appear inside the JSON-LD

Complements scripts/verify_live_patch_seo.py (patch notes); this script owns
the augment/item/champion structured-data surface.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_LOCALE = "en"

ENTITY_TYPES = {
    "augment": "DefinedTerm",
    "item": "Thing",
    "champion": "Person",
}

FORBIDDEN_TERMS = [
    "oracleScore",
    "modelWeights",
    "scoreBreakdown",
    "computedPool",
    "championPools",
    "poolRules",
    "signals",
    "provenance",
    "data/internal",
    "prompt",
    "openai",
    "anthropic",
    "llm",
    "cerebras",
    "supabase",
    "member",
    "session",
]

JSON_LD_PATTERN = re.compile(
    r'<script type="application/ld\+json">(.*?)</script>', re.DOTALL
)


@dataclass
class JsonLdCheck:
    name: str
    ok: bool
    detail: str = ""


@dataclass(frozen=True)
class RoutingConfig:
    locales: tuple[str, ...]
    default_locale: str


def load_routing_config(repo_root: Path = REPO_ROOT) -> RoutingConfig:
    routing_path = repo_root / "src" / "i18n" / "routing.ts"
    source = routing_path.read_text()

    locales_match = re.search(r"locales\s*:\s*\[([^\]]+)\]", source, re.DOTALL)
    if not locales_match:
        raise RuntimeError(f"Could not find locales in {routing_path}")
    locales = tuple(
        match.group(1) or match.group(2)
        for match in re.finditer(r'"([^"]+)"|\'([^\']+)\'', locales_match.group(1))
    )
    if not locales:
        raise RuntimeError(f"No locales found in {routing_path}")

    default_match = re.search(r"defaultLocale\s*:\s*[\"']([^\"']+)[\"']", source)
    if not default_match:
        raise RuntimeError(f"Could not find default locale in {routing_path}")
    default_locale = default_match.group(1)
    if default_locale != DEFAULT_LOCALE:
        raise RuntimeError(
            f"Routing default locale {default_locale!r} does not match "
            f"DEFAULT_LOCALE {DEFAULT_LOCALE!r}"
        )
    if default_locale not in locales:
        raise RuntimeError(f"Routing default locale {default_locale!r} is not in locales")

    messages_dir = repo_root / "messages"
    missing_messages = [
        f"messages/{locale}.json"
        for locale in locales
        if not (messages_dir / f"{locale}.json").is_file()
    ]
    if missing_messages:
        raise RuntimeError(
            "Missing message files for routed locales: " + ", ".join(missing_messages)
        )

    return RoutingConfig(locales=locales, default_locale=default_locale)


ROUTING_CONFIG = load_routing_config()
SUPPORTED_LOCALES = list(ROUTING_CONFIG.locales)


def normalize_base_url(base_url: str) -> str:
    return base_url.rstrip("/")


def localized_path(route: str, locale: str) -> str:
    prefix = "" if locale == DEFAULT_LOCALE else f"/{locale}"
    return f"{prefix}{route}"


def extract_json_ld_blocks(html: str) -> list[dict]:
    blocks = []
    for raw in JSON_LD_PATTERN.findall(html):
        try:
            blocks.append(json.loads(raw))
        except json.JSONDecodeError:
            blocks.append({"__parse_error__": True, "__raw__": raw[:200]})
    return blocks


def find_detail_graph(blocks: list[dict]) -> list[dict] | None:
    """Return the @graph whose nodes include a WebPage (skips the WebSite block)."""
    for block in blocks:
        graph = block.get("@graph")
        if isinstance(graph, list) and any(
            node.get("@type") == "WebPage" for node in graph
        ):
            return graph
    return None


def forbidden_hits(blocks: list[dict]) -> list[str]:
    serialized = json.dumps(blocks).lower()
    return [term for term in FORBIDDEN_TERMS if term.lower() in serialized]


def check_detail_graph(
    graph: list[dict],
    entity_type: str,
    locale: str,
    expected_home: str,
) -> list[str]:
    failures: list[str] = []

    types = [node.get("@type") for node in graph]
    expected_types = ["WebPage", "BreadcrumbList", entity_type]
    if types != expected_types:
        failures.append(f"graph types {types} != {expected_types}")

    web_page = next((n for n in graph if n.get("@type") == "WebPage"), None)
    if not web_page:
        failures.append("missing WebPage node")
    elif web_page.get("inLanguage") != locale:
        failures.append(
            f"WebPage.inLanguage {web_page.get('inLanguage')!r} != {locale!r}"
        )

    breadcrumb = next((n for n in graph if n.get("@type") == "BreadcrumbList"), None)
    if not breadcrumb:
        failures.append("missing BreadcrumbList node")
    else:
        items = breadcrumb.get("itemListElement") or []
        home = items[0].get("item") if items else None
        if home != expected_home:
            failures.append(f"breadcrumb home {home!r} != {expected_home!r}")

    return failures


def pick_targets(repo_root: Path) -> dict[str, str]:
    """Choose one live route per entity kind from the published public data."""
    data_dir = repo_root / "public" / "data"
    augments = json.loads((data_dir / "augments.json").read_text())["augments"]
    items = json.loads((data_dir / "items.json").read_text())
    champions = json.loads((data_dir / "champions.json").read_text())["champions"]

    item = (items.get("mayhemExclusive") or [None])[0]
    item_identifier = (
        item["slug"]
        if item
        else str(next(i["id"] for i in items["items"] if i.get("id") is not None))
    )

    return {
        "augment": f"/augments/{augments[0]['slug']}",
        "item": f"/items/{item_identifier}",
        "champion": f"/champions/{champions[0]['slug']}",
    }


def fetch(url: str, timeout: int = 30) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "mayhem-oracle-jsonld-verifier"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def run_checks(base_url: str, locales: list[str], targets: dict[str, str]) -> list[JsonLdCheck]:
    checks: list[JsonLdCheck] = []
    base = normalize_base_url(base_url)

    for locale in locales:
        expected_home = base if locale == "en" else f"{base}/{locale}"

        for kind, route in targets.items():
            url = f"{base}{localized_path(route, locale)}"
            name = f"{locale}:{kind}"
            try:
                html = fetch(url)
            except Exception as error:  # noqa: BLE001 - report, don't crash the sweep
                checks.append(JsonLdCheck(name, False, f"fetch failed: {error}"))
                continue

            blocks = extract_json_ld_blocks(html)
            graph = find_detail_graph(blocks)
            if graph is None:
                checks.append(JsonLdCheck(name, False, "no detail @graph found"))
                continue

            failures = check_detail_graph(graph, ENTITY_TYPES[kind], locale, expected_home)
            failures.extend(
                f"forbidden term in JSON-LD: {term}" for term in forbidden_hits(blocks)
            )
            checks.append(
                JsonLdCheck(name, not failures, "; ".join(failures))
            )

    return checks


def summarize_checks(checks: list[JsonLdCheck]) -> dict:
    failures = [
        {"name": check.name, "detail": check.detail}
        for check in checks
        if not check.ok
    ]
    return {
        "checked": len(checks),
        "passed": len(checks) - len(failures),
        "failed": len(failures),
        "failures": failures,
        "ok": not failures,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="https://wasfun.lol")
    parser.add_argument(
        "--locales",
        default=",".join(SUPPORTED_LOCALES),
        help="Comma-separated locale subset (default: all routed locales)",
    )
    args = parser.parse_args()

    locales = [locale.strip() for locale in args.locales.split(",") if locale.strip()]
    targets = pick_targets(Path(__file__).resolve().parent.parent)
    checks = run_checks(args.base_url, locales, targets)
    summary = summarize_checks(checks)

    print(f"Live JSON-LD verification for {normalize_base_url(args.base_url)}")
    print(f"Checks: {summary['passed']}/{summary['checked']} passed")
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
