#!/usr/bin/env python3
"""Verify live patch-note SEO output against public patch data."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parent.parent
PATCH_NOTES_PATH = ROOT / "public" / "data" / "patch-notes.json"
SUPPORTED_LOCALES = ("en", "zh-TW", "zh-CN", "ja", "ko")
DEFAULT_LOCALE = "en"
USER_AGENT = "mayhem-oracle-live-seo-verifier/1.0"


@dataclass(frozen=True)
class ExpectedRoutes:
    list_paths: list[str]
    detail_paths: list[str]
    newest_patch: dict[str, Any]


@dataclass(frozen=True)
class FetchResponse:
    url: str
    status: int
    body: str
    error: str | None = None


@dataclass(frozen=True)
class SeoCheck:
    kind: str
    url: str
    passed: bool
    failures: list[str]


class SeoHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.anchor_hrefs: list[str] = []
        self.link_tags: list[dict[str, str]] = []
        self.ids: set[str] = set()
        self.json_ld_scripts: list[str] = []
        self._in_json_ld = False
        self._script_chunks: list[str] = []

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        attr_map = {key.lower(): value or "" for key, value in attrs}
        tag = tag.lower()

        element_id = attr_map.get("id")
        if element_id:
            self.ids.add(element_id)

        if tag == "a" and attr_map.get("href"):
            self.anchor_hrefs.append(attr_map["href"])
        elif tag == "link":
            self.link_tags.append(attr_map)
        elif tag == "script":
            script_type = attr_map.get("type", "").split(";", 1)[0].lower()
            if script_type == "application/ld+json":
                self._in_json_ld = True
                self._script_chunks = []

    def handle_data(self, data: str) -> None:
        if self._in_json_ld:
            self._script_chunks.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "script" and self._in_json_ld:
            script = "".join(self._script_chunks).strip()
            if script:
                self.json_ld_scripts.append(script)
            self._in_json_ld = False
            self._script_chunks = []


def normalize_base_url(value: str | None) -> str:
    normalized = (value or "").strip().rstrip("/")
    if not normalized:
        raise ValueError("base URL is required")
    parsed = urllib.parse.urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("base URL must start with http:// or https://")
    return normalized


def localized_path(path: str, locale: str) -> str:
    route = path if path.startswith("/") else f"/{path}"
    return f"/{locale}{route}"


def patch_detail_route(version: str) -> str:
    return f"/patch-notes/{urllib.parse.quote(version, safe='')}"


def slug_segment(value: str) -> str:
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", value.lower()))


def patch_note_anchor(patch: str) -> str:
    return f"patch-{slug_segment(patch)}"


def patch_note_section_anchor(patch: str, section_id: str) -> str:
    return f"{patch_note_anchor(patch)}-{slug_segment(section_id) or 'section'}"


def absolute_url(base_url: str, path: str) -> str:
    route = path if path.startswith("/") else f"/{path}"
    return f"{base_url}{route}"


def normalize_url_for_compare(url: str) -> str:
    return url.rstrip("/") or url


def load_patch_notes(path: Path = PATCH_NOTES_PATH) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("public/data/patch-notes.json must be a JSON object")
    patches = data.get("patches")
    if not isinstance(patches, list) or not patches:
        raise ValueError("public/data/patch-notes.json must include patches")
    return data


def build_expected_routes(data: dict[str, Any]) -> ExpectedRoutes:
    patches = [patch for patch in data.get("patches", []) if isinstance(patch, dict)]
    if not patches:
        raise ValueError("patch data must include at least one patch object")

    current_version = data.get("patch")
    newest_patch = next(
        (
            patch
            for patch in patches
            if isinstance(current_version, str) and patch.get("version") == current_version
        ),
        patches[0],
    )

    list_paths = [localized_path("/patch-notes", locale) for locale in SUPPORTED_LOCALES]
    detail_paths = [
        localized_path(patch_detail_route(str(patch["version"])), locale)
        for patch in patches
        if patch.get("version")
        for locale in SUPPORTED_LOCALES
    ]
    return ExpectedRoutes(
        list_paths=list_paths,
        detail_paths=detail_paths,
        newest_patch=newest_patch,
    )


def parse_sitemap_urls(xml: str) -> set[str]:
    root = ET.fromstring(xml)
    urls: set[str] = set()
    for element in root.iter():
        if element.tag.rsplit("}", 1)[-1] == "loc" and element.text:
            urls.add(element.text.strip())
    return urls


def parse_html(html: str) -> SeoHtmlParser:
    parser = SeoHtmlParser()
    parser.feed(html)
    parser.close()
    return parser


def extract_json_ld_nodes(html: str) -> list[dict[str, Any]]:
    parser = parse_html(html)
    nodes: list[dict[str, Any]] = []
    for script in parser.json_ld_scripts:
        try:
            parsed = json.loads(script)
        except json.JSONDecodeError:
            continue
        candidates = parsed if isinstance(parsed, list) else [parsed]
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            graph = candidate.get("@graph")
            if isinstance(graph, list):
                nodes.extend(node for node in graph if isinstance(node, dict))
            else:
                nodes.append(candidate)
    return nodes


def node_has_type(node: dict[str, Any], expected_type: str) -> bool:
    node_type = node.get("@type")
    if isinstance(node_type, list):
        return expected_type in node_type
    return node_type == expected_type


def node_text(node: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = node.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


def parse_date_value(value: str) -> date:
    text = value.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return date.fromisoformat(text)
    normalized = text.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).date()


def expected_patch_date(patch: dict[str, Any]) -> date | None:
    for key in ("publishedAt", "released"):
        value = patch.get(key)
        if isinstance(value, str) and value:
            return parse_date_value(value)
    return None


def fetch_url(url: str, timeout: int = 20) -> FetchResponse:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            body = response.read().decode(charset, errors="replace")
            return FetchResponse(url=url, status=response.getcode(), body=body)
    except urllib.error.HTTPError as exc:
        charset = exc.headers.get_content_charset() if exc.headers else None
        body = exc.read().decode(charset or "utf-8", errors="replace")
        return FetchResponse(url=url, status=exc.code, body=body, error=str(exc))
    except urllib.error.URLError as exc:
        return FetchResponse(url=url, status=0, body="", error=str(exc.reason))


def href_to_path(href: str) -> str:
    parsed = urllib.parse.urlparse(href)
    if parsed.scheme or parsed.netloc:
        return parsed.path.rstrip("/") or "/"
    return (parsed.path or "/").rstrip("/") or "/"


def rel_tokens(link: dict[str, str]) -> set[str]:
    return {token.lower() for token in link.get("rel", "").split()}


def check_status(response: FetchResponse, failures: list[str]) -> bool:
    if response.status != 200:
        suffix = f": {response.error}" if response.error else ""
        failures.append(f"HTTP {response.status}{suffix}")
        return False
    return True


def check_sitemap(
    *,
    fetch_base_url: str,
    canonical_base_url: str,
    routes: ExpectedRoutes,
    fetcher: Callable[[str], FetchResponse],
) -> SeoCheck:
    url = absolute_url(fetch_base_url, "/sitemap.xml")
    response = fetcher(url)
    failures: list[str] = []
    if not check_status(response, failures):
        return SeoCheck("sitemap", url, False, failures)

    try:
        urls = parse_sitemap_urls(response.body)
    except ET.ParseError as exc:
        failures.append(f"sitemap XML parse failed: {exc}")
        return SeoCheck("sitemap", url, False, failures)

    expected = {absolute_url(canonical_base_url, path) for path in routes.list_paths}
    expected.update(absolute_url(canonical_base_url, path) for path in routes.detail_paths)
    missing = sorted(expected - urls)
    stale_anchors = sorted(
        sitemap_url
        for sitemap_url in urls
        if "/patch-notes#" in sitemap_url or "#patch-" in sitemap_url
    )

    if missing:
        failures.append(f"missing sitemap URL(s): {', '.join(missing[:8])}")
        if len(missing) > 8:
            failures.append(f"...and {len(missing) - 8} more missing sitemap URL(s)")
    if stale_anchors:
        failures.append(
            f"stale patch-note anchor URL(s) in sitemap: {', '.join(stale_anchors[:8])}",
        )

    return SeoCheck("sitemap", url, not failures, failures)


def check_list_page(
    *,
    base_url: str,
    locale: str,
    patches: list[dict[str, Any]],
    fetcher: Callable[[str], FetchResponse],
) -> SeoCheck:
    path = localized_path("/patch-notes", locale)
    url = absolute_url(base_url, path)
    response = fetcher(url)
    failures: list[str] = []
    if not check_status(response, failures):
        return SeoCheck("list", url, False, failures)

    parser = parse_html(response.body)
    href_paths = {href_to_path(href) for href in parser.anchor_hrefs}
    expected_paths = {
        localized_path(patch_detail_route(str(patch["version"])), locale)
        for patch in patches
        if patch.get("version")
    }
    missing = sorted(expected_paths - href_paths)
    if missing:
        failures.append(f"missing crawlable detail link(s): {', '.join(missing[:8])}")
        if len(missing) > 8:
            failures.append(f"...and {len(missing) - 8} more missing detail link(s)")

    return SeoCheck("list", url, not failures, failures)


def check_canonical(
    *,
    parser: SeoHtmlParser,
    expected_url: str,
    failures: list[str],
) -> None:
    canonical_hrefs = [
        link.get("href", "")
        for link in parser.link_tags
        if "canonical" in rel_tokens(link)
    ]
    normalized_expected = normalize_url_for_compare(expected_url)
    normalized_hrefs = {normalize_url_for_compare(href) for href in canonical_hrefs}
    if normalized_expected not in normalized_hrefs:
        failures.append(f"missing canonical URL: {expected_url}")


def check_hreflang(
    *,
    parser: SeoHtmlParser,
    base_url: str,
    route: str,
    failures: list[str],
) -> None:
    alternates = {
        link.get("hreflang", ""): link.get("href", "")
        for link in parser.link_tags
        if "alternate" in rel_tokens(link) and link.get("hreflang")
    }
    for locale in SUPPORTED_LOCALES:
        expected = absolute_url(base_url, localized_path(route, locale))
        actual = alternates.get(locale)
        if normalize_url_for_compare(actual or "") != normalize_url_for_compare(expected):
            failures.append(f"missing hreflang {locale}: {expected}")


def check_article_json_ld(
    *,
    nodes: list[dict[str, Any]],
    patch: dict[str, Any],
    failures: list[str],
) -> None:
    version = str(patch.get("version", ""))
    article = next((node for node in nodes if node_has_type(node, "Article")), None)
    if not article:
        failures.append("missing Article JSON-LD")
        return

    headline = node_text(article, "headline", "name")
    if version not in headline:
        failures.append(f"Article headline/name does not include patch {version}")

    expected_date = expected_patch_date(patch)
    if expected_date is None:
        failures.append(f"patch {version} is missing publishedAt/released in public data")
        return

    for key in ("datePublished", "dateModified"):
        raw_value = article.get(key)
        if not isinstance(raw_value, str) or not raw_value:
            failures.append(f"Article {key} is missing")
            continue
        try:
            actual_date = parse_date_value(raw_value)
        except ValueError:
            failures.append(f"Article {key} is not a valid date: {raw_value}")
            continue
        if actual_date != expected_date:
            failures.append(
                f"Article {key} should use patch date {expected_date.isoformat()}, "
                f"got {raw_value}",
            )


def check_breadcrumb_json_ld(
    *,
    nodes: list[dict[str, Any]],
    locale: str,
    patch: dict[str, Any],
    failures: list[str],
) -> None:
    breadcrumb = next(
        (node for node in nodes if node_has_type(node, "BreadcrumbList")),
        None,
    )
    if not breadcrumb:
        failures.append("missing BreadcrumbList JSON-LD")
        return

    items = breadcrumb.get("itemListElement")
    if not isinstance(items, list) or len(items) != 3:
        failures.append("BreadcrumbList must have exactly 3 levels")
        return

    names = [item.get("name") if isinstance(item, dict) else None for item in items]
    if names[0] != "Mayhem Oracle":
        failures.append("breadcrumb level 1 must be Mayhem Oracle")
    if locale == DEFAULT_LOCALE and names[1] != "Patch Notes":
        failures.append("breadcrumb level 2 must be Patch Notes")
    if not isinstance(names[1], str) or not names[1]:
        failures.append("breadcrumb level 2 label is missing")

    version = str(patch.get("version", ""))
    if not isinstance(names[2], str) or version not in names[2]:
        failures.append(f"breadcrumb level 3 must include patch {version}")

    positions = [
        item.get("position") if isinstance(item, dict) else None
        for item in items
    ]
    if positions != [1, 2, 3]:
        failures.append("breadcrumb positions must be 1, 2, 3")


def check_section_ids(
    *,
    parser: SeoHtmlParser,
    patch: dict[str, Any],
    failures: list[str],
) -> None:
    version = str(patch.get("version", ""))
    expected_ids = []
    for section in patch.get("sections", []):
        if not isinstance(section, dict) or not section.get("id"):
            continue
        changes = section.get("changes")
        if isinstance(changes, list) and changes:
            expected_ids.append(patch_note_section_anchor(version, str(section["id"])))

    missing = sorted(set(expected_ids) - parser.ids)
    if missing:
        failures.append(f"missing patch section id(s): {', '.join(missing[:8])}")
        if len(missing) > 8:
            failures.append(f"...and {len(missing) - 8} more missing section id(s)")


def check_detail_page(
    *,
    base_url: str,
    canonical_base_url: str,
    locale: str,
    patch: dict[str, Any],
    fetcher: Callable[[str], FetchResponse],
) -> SeoCheck:
    version = str(patch.get("version", ""))
    route = patch_detail_route(version)
    path = localized_path(route, locale)
    url = absolute_url(base_url, path)
    response = fetcher(url)
    failures: list[str] = []
    if not check_status(response, failures):
        return SeoCheck("detail", url, False, failures)

    parser = parse_html(response.body)
    nodes = extract_json_ld_nodes(response.body)
    check_canonical(
        parser=parser,
        expected_url=absolute_url(canonical_base_url, path),
        failures=failures,
    )
    check_hreflang(parser=parser, base_url=canonical_base_url, route=route, failures=failures)
    check_article_json_ld(nodes=nodes, patch=patch, failures=failures)
    check_breadcrumb_json_ld(
        nodes=nodes,
        locale=locale,
        patch=patch,
        failures=failures,
    )
    check_section_ids(parser=parser, patch=patch, failures=failures)
    return SeoCheck("detail", url, not failures, failures)


def summarize_checks(checks: list[SeoCheck]) -> dict[str, Any]:
    failures = [
        {"kind": check.kind, "url": check.url, "messages": check.failures}
        for check in checks
        if not check.passed
    ]
    return {
        "ok": not failures,
        "checked": len(checks),
        "passed": sum(1 for check in checks if check.passed),
        "failed": len(failures),
        "failures": failures,
    }


def verify_live_patch_seo(
    *,
    base_url: str,
    canonical_base_url: str | None = None,
    all_patches: bool = False,
    patch_notes_path: Path = PATCH_NOTES_PATH,
    fetcher: Callable[[str], FetchResponse] = fetch_url,
) -> dict[str, Any]:
    base_url = normalize_base_url(base_url)
    canonical_base_url = normalize_base_url(canonical_base_url or base_url)
    data = load_patch_notes(patch_notes_path)
    routes = build_expected_routes(data)
    patches = [patch for patch in data["patches"] if isinstance(patch, dict)]
    patches_to_fetch = patches if all_patches else [routes.newest_patch]

    checks: list[SeoCheck] = [
        check_sitemap(
            fetch_base_url=base_url,
            canonical_base_url=canonical_base_url,
            routes=routes,
            fetcher=fetcher,
        ),
    ]
    checks.extend(
        check_list_page(
            base_url=base_url,
            locale=locale,
            patches=patches,
            fetcher=fetcher,
        )
        for locale in SUPPORTED_LOCALES
    )
    checks.extend(
        check_detail_page(
            base_url=base_url,
            canonical_base_url=canonical_base_url,
            locale=locale,
            patch=patch,
            fetcher=fetcher,
        )
        for patch in patches_to_fetch
        for locale in SUPPORTED_LOCALES
    )

    summary = summarize_checks(checks)
    summary.update(
        {
            "baseUrl": base_url,
            "canonicalBaseUrl": canonical_base_url,
            "mode": "all" if all_patches else "newest",
            "patchesExpected": len(patches),
            "detailPagesFetched": len(patches_to_fetch) * len(SUPPORTED_LOCALES),
        },
    )
    return summary


def print_human_summary(summary: dict[str, Any]) -> None:
    print(f"Live patch-note SEO verification for {summary['baseUrl']}")
    print(
        f"Checks: {summary['passed']}/{summary['checked']} passed "
        f"({summary['mode']} detail mode)",
    )
    if summary["ok"]:
        print("No SEO verification failures found.")
        return

    print("Failures:")
    for failure in summary["failures"]:
        print(f"- {failure['kind']}: {failure['url']}")
        for message in failure["messages"]:
            print(f"  - {message}")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Verify deployed patch-note SEO artifacts against "
            "public/data/patch-notes.json."
        ),
    )
    parser.add_argument(
        "--base-url",
        default=None,
        help="Deployed base URL, e.g. https://wasfun.lol. Falls back to LIVE_BASE_URL.",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Fetch every localized patch detail page instead of only the newest patch.",
    )
    parser.add_argument(
        "--canonical-base-url",
        default="https://wasfun.lol",
        help="Expected public canonical origin when fetching a local preview.",
    )
    parser.add_argument(
        "--patch-notes",
        type=Path,
        default=PATCH_NOTES_PATH,
        help=argparse.SUPPRESS,
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    raw_base_url = args.base_url or os.environ.get("LIVE_BASE_URL")
    try:
        base_url = normalize_base_url(raw_base_url)
    except ValueError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, sort_keys=True), file=sys.stderr)
        return 2

    summary = verify_live_patch_seo(
        base_url=base_url,
        canonical_base_url=args.canonical_base_url,
        all_patches=args.all,
        patch_notes_path=args.patch_notes,
    )
    print_human_summary(summary)
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
