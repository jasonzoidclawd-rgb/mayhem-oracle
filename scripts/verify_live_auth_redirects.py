#!/usr/bin/env python3
"""Verify live auth signout redirect sanitization against production."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable

DEFAULT_BASE_URL = "https://wasfun.lol"
EXPECTED_MATCHED_PATH = "/api/auth/signout"
USER_AGENT = "mayhem-oracle-live-auth-redirect-verifier/1.0"


@dataclass(frozen=True)
class AuthRedirectCase:
    name: str
    next_value: str
    expected_location: str


@dataclass(frozen=True)
class FetchResult:
    url: str
    status: int
    location: str | None
    matched_path: str | None
    error: str | None = None


@dataclass(frozen=True)
class AuthRedirectCheck:
    name: str
    url: str
    ok: bool
    detail: str = ""


FetchRedirect = Callable[[str], FetchResult]


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self,
        req: urllib.request.Request,
        fp,
        code: int,
        msg: str,
        headers,
        newurl: str,
    ):
        return None


def normalize_base_url(value: str | None) -> str:
    normalized = (value or "").strip().rstrip("/")
    if not normalized:
        raise ValueError("base URL is required")
    parsed = urllib.parse.urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("base URL must start with http:// or https://")
    return normalized


def default_cases(base_url: str) -> list[AuthRedirectCase]:
    base = normalize_base_url(base_url)
    return [
        AuthRedirectCase(
            "safe localized account",
            "/zh-TW/account",
            f"{base}/zh-TW/account",
        ),
        AuthRedirectCase(
            "encoded api bypass",
            "/%61pi/admin/entitlements",
            f"{base}/",
        ),
        AuthRedirectCase(
            "double-encoded api bypass",
            "/%2561pi/admin/entitlements",
            f"{base}/",
        ),
        AuthRedirectCase(
            "locale-prefixed auth callback",
            "/zh-TW/auth/callback",
            f"{base}/",
        ),
        AuthRedirectCase(
            "encoded locale and auth callback",
            "/%7A%68-TW/%61uth/callback",
            f"{base}/",
        ),
        AuthRedirectCase(
            "case-insensitive internal prefix",
            "/API/admin",
            f"{base}/",
        ),
        AuthRedirectCase(
            "safe lookalike",
            "/apiary",
            f"{base}/apiary",
        ),
    ]


def build_signout_url(base_url: str, case: AuthRedirectCase) -> str:
    base = normalize_base_url(base_url)
    query = urllib.parse.urlencode({"next": case.next_value})
    return f"{base}/api/auth/signout?{query}"


def fetch_redirect(url: str, timeout: int = 20) -> FetchResult:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT},
        method="POST",
    )
    opener = urllib.request.build_opener(NoRedirectHandler)

    try:
        response = opener.open(request, timeout=timeout)
    except urllib.error.HTTPError as error:
        response = error
    except urllib.error.URLError as error:
        return FetchResult(
            url=url,
            status=0,
            location=None,
            matched_path=None,
            error=str(error.reason),
        )

    return FetchResult(
        url=url,
        status=response.getcode(),
        location=response.headers.get("Location"),
        matched_path=response.headers.get("x-matched-path"),
    )


def check_result(case: AuthRedirectCase, result: FetchResult) -> AuthRedirectCheck:
    failures: list[str] = []
    if result.error:
        failures.append(f"fetch failed: {result.error}")
    if result.status != 303:
        failures.append(f"status {result.status} != 303")
    if result.location != case.expected_location:
        failures.append(
            f"location {result.location!r} != {case.expected_location!r}"
        )
    if result.matched_path is not None and result.matched_path != EXPECTED_MATCHED_PATH:
        failures.append(
            f"x-matched-path {result.matched_path!r} != {EXPECTED_MATCHED_PATH!r}"
        )

    return AuthRedirectCheck(
        name=case.name,
        url=result.url,
        ok=not failures,
        detail="; ".join(failures),
    )


def run_checks(
    base_url: str,
    *,
    cases: list[AuthRedirectCase] | None = None,
    fetcher: FetchRedirect = fetch_redirect,
) -> list[AuthRedirectCheck]:
    base = normalize_base_url(base_url)
    checks: list[AuthRedirectCheck] = []

    for case in cases or default_cases(base):
        url = build_signout_url(base, case)
        try:
            result = fetcher(url)
        except Exception as error:  # noqa: BLE001 - report, don't crash the sweep
            result = FetchResult(
                url=url,
                status=0,
                location=None,
                matched_path=None,
                error=str(error),
            )
        checks.append(check_result(case, result))

    return checks


def summarize_checks(checks: list[AuthRedirectCheck]) -> dict:
    failures = [
        {"name": check.name, "url": check.url, "detail": check.detail}
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
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    args = parser.parse_args()

    base_url = normalize_base_url(args.base_url)
    checks = run_checks(base_url)
    summary = summarize_checks(checks)

    print(f"Live auth redirect verification for {base_url}")
    print(f"Checks: {summary['passed']}/{summary['checked']} passed")
    if summary["ok"]:
        print("No auth redirect verification failures found.")
    else:
        print("Auth redirect verification failures found:")
        for failure in summary["failures"]:
            print(f"- {failure['name']}: {failure['detail']}")
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
