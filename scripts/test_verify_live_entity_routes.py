#!/usr/bin/env python3

from __future__ import annotations

import unittest
from pathlib import Path

from verify_live_entity_routes import (
    EntityTarget,
    FetchResponse,
    run_checks,
)


ROOT = Path(__file__).resolve().parent.parent


class LiveEntityRouteTests(unittest.TestCase):
    def test_known_routes_need_entity_name_and_unknown_routes_need_404(self):
        targets = {
            "champion": EntityTarget("champion", "/champions/locke", "Locke"),
            "augment": EntityTarget("augment", "/augments/tank-engine", "Tank Engine"),
            "item": EntityTarget("item", "/items/atmas-reckoning", "Atma's Reckoning"),
        }

        def fetcher(url: str) -> FetchResponse:
            if url.endswith("/champions/locke"):
                return FetchResponse(url, 200, "<h1>Locke</h1>")
            if url.endswith("/augments/tank-engine"):
                return FetchResponse(url, 200, "<h1>Tank Engine</h1>")
            if url.endswith("/items/atmas-reckoning"):
                return FetchResponse(url, 200, "<h1>Atma's Reckoning</h1>")
            return FetchResponse(url, 404, "Not found")

        checks = run_checks("https://wasfun.lol", targets, fetcher)

        self.assertEqual(len(checks), 9)
        self.assertTrue(all(check.passed for check in checks), checks)
        self.assertEqual(
            [check.kind for check in checks if check.expected_status == 404],
            ["champion:unknown", "champion:unknown", "augment:unknown", "augment:unknown", "item:unknown", "item:unknown"],
        )

    def test_known_body_and_unknown_status_fail_closed(self):
        targets = {
            "champion": EntityTarget("champion", "/champions/locke", "Locke"),
        }

        def fetcher(url: str) -> FetchResponse:
            if url.endswith("/champions/locke"):
                return FetchResponse(url, 200, "<h1>error-state</h1>")
            return FetchResponse(url, 200, "<h1>not found</h1>")

        checks = run_checks("https://wasfun.lol", targets, fetcher)

        self.assertFalse(checks[0].passed)
        self.assertIn("Locke", checks[0].failures[0])
        self.assertFalse(checks[1].passed)
        self.assertIn("expected HTTP 404", checks[1].failures[0])

    def test_verify_live_seo_workflow_runs_the_entity_probe(self):
        workflow = (ROOT / ".github" / "workflows" / "verify-live-seo.yml").read_text()

        self.assertIn("scripts/verify_live_entity_routes.py", workflow)
        self.assertIn('BASE_URL: ${{ github.event_name == \'workflow_dispatch\' && inputs.base_url || \'https://wasfun.lol\' }}', workflow)


if __name__ == "__main__":
    unittest.main()
