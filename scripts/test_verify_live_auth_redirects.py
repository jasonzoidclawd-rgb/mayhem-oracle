#!/usr/bin/env python3

from __future__ import annotations

import unittest

from verify_live_auth_redirects import (
    EXPECTED_MATCHED_PATH,
    AuthRedirectCase,
    FetchResult,
    build_signout_url,
    default_cases,
    normalize_base_url,
    run_checks,
    summarize_checks,
)


def fetcher_for(results: dict[str, FetchResult]):
    def fetcher(url: str) -> FetchResult:
        return results[url]

    return fetcher


class LiveAuthRedirectVerifierTests(unittest.TestCase):
    def test_normalize_base_url_strips_trailing_slashes(self) -> None:
        self.assertEqual(
            normalize_base_url("https://wasfun.lol///"),
            "https://wasfun.lol",
        )

    def test_default_cases_cover_required_redirect_contract(self) -> None:
        cases = default_cases("https://wasfun.lol")

        self.assertEqual(len(cases), 7)
        self.assertEqual(
            [(case.name, case.next_value, case.expected_location) for case in cases],
            [
                (
                    "safe localized account",
                    "/zh-TW/account",
                    "https://wasfun.lol/zh-TW/account",
                ),
                (
                    "encoded api bypass",
                    "/%61pi/admin/entitlements",
                    "https://wasfun.lol/",
                ),
                (
                    "double-encoded api bypass",
                    "/%2561pi/admin/entitlements",
                    "https://wasfun.lol/",
                ),
                (
                    "locale-prefixed auth callback",
                    "/zh-TW/auth/callback",
                    "https://wasfun.lol/",
                ),
                (
                    "encoded locale and auth callback",
                    "/%7A%68-TW/%61uth/callback",
                    "https://wasfun.lol/",
                ),
                (
                    "case-insensitive internal prefix",
                    "/API/admin",
                    "https://wasfun.lol/",
                ),
                (
                    "safe lookalike",
                    "/apiary",
                    "https://wasfun.lol/apiary",
                ),
            ],
        )

    def test_signout_url_encodes_next_query_value(self) -> None:
        url = build_signout_url(
            "https://wasfun.lol",
            AuthRedirectCase(
                name="encoded api bypass",
                next_value="/%61pi/admin/entitlements",
                expected_location="https://wasfun.lol/",
            ),
        )

        self.assertEqual(
            url,
            "https://wasfun.lol/api/auth/signout?next=%2F%2561pi%2Fadmin%2Fentitlements",
        )

    def test_run_checks_passes_all_default_cases_with_mocked_redirects(self) -> None:
        base_url = "https://wasfun.lol"
        cases = default_cases(base_url)
        results = {
            build_signout_url(base_url, case): FetchResult(
                url=build_signout_url(base_url, case),
                status=303,
                location=case.expected_location,
                matched_path=EXPECTED_MATCHED_PATH,
            )
            for case in cases
        }

        checks = run_checks(base_url, fetcher=fetcher_for(results))
        summary = summarize_checks(checks)

        self.assertTrue(summary["ok"])
        self.assertEqual(summary["checked"], 7)
        self.assertEqual(summary["passed"], 7)
        self.assertEqual(summary["failed"], 0)
        self.assertEqual(summary["failures"], [])

    def test_missing_matched_path_header_is_allowed(self) -> None:
        base_url = "https://wasfun.lol"
        case = default_cases(base_url)[0]

        checks = run_checks(
            base_url,
            cases=[case],
            fetcher=fetcher_for(
                {
                    build_signout_url(base_url, case): FetchResult(
                        url=build_signout_url(base_url, case),
                        status=303,
                        location=case.expected_location,
                        matched_path=None,
                    )
                }
            ),
        )

        self.assertTrue(checks[0].ok)

    def test_status_location_and_matched_path_failures_are_reported(self) -> None:
        base_url = "https://wasfun.lol"
        cases = [
            AuthRedirectCase("bad status", "/apiary", "https://wasfun.lol/apiary"),
            AuthRedirectCase("bad location", "/authors", "https://wasfun.lol/authors"),
            AuthRedirectCase("bad matched path", "/account", "https://wasfun.lol/account"),
        ]
        results = {
            build_signout_url(base_url, cases[0]): FetchResult(
                url=build_signout_url(base_url, cases[0]),
                status=302,
                location=cases[0].expected_location,
                matched_path=EXPECTED_MATCHED_PATH,
            ),
            build_signout_url(base_url, cases[1]): FetchResult(
                url=build_signout_url(base_url, cases[1]),
                status=303,
                location="https://wasfun.lol/wrong",
                matched_path=EXPECTED_MATCHED_PATH,
            ),
            build_signout_url(base_url, cases[2]): FetchResult(
                url=build_signout_url(base_url, cases[2]),
                status=303,
                location=cases[2].expected_location,
                matched_path="/wrong",
            ),
        }

        checks = run_checks(base_url, cases=cases, fetcher=fetcher_for(results))
        summary = summarize_checks(checks)

        self.assertFalse(summary["ok"])
        self.assertEqual(summary["checked"], 3)
        self.assertEqual(summary["failed"], 3)
        self.assertTrue(any("status 302 != 303" in check.detail for check in checks))
        self.assertTrue(any("location" in check.detail for check in checks))
        self.assertTrue(any("x-matched-path" in check.detail for check in checks))

    def test_fetch_errors_are_reported_as_failures(self) -> None:
        def failing_fetcher(url: str) -> FetchResult:
            raise OSError("network unavailable")

        checks = run_checks(
            "https://wasfun.lol",
            cases=[
                AuthRedirectCase(
                    "safe lookalike",
                    "/apiary",
                    "https://wasfun.lol/apiary",
                )
            ],
            fetcher=failing_fetcher,
        )

        self.assertFalse(checks[0].ok)
        self.assertIn("fetch failed", checks[0].detail)


if __name__ == "__main__":
    unittest.main()
