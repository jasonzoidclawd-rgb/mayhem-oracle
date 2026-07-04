#!/usr/bin/env python3

from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = ROOT / ".github" / "workflows" / "verify-live-seo.yml"


class VerifyLiveSeoWorkflowTests(unittest.TestCase):
    def workflow_text(self) -> str:
        self.assertTrue(WORKFLOW.exists(), "workflow file must exist")
        return WORKFLOW.read_text(encoding="utf-8")

    def test_workflow_dispatch_inputs_and_schedule_are_configured(self):
        text = self.workflow_text()

        self.assertIn("name: Verify Live SEO", text)
        self.assertRegex(text, r"(?m)^\s*workflow_dispatch:\s*$")
        self.assertRegex(text, r"(?m)^\s*base_url:\s*$")
        self.assertIn("description: Base URL to verify", text)
        self.assertIn("default: https://wasfun.lol", text)
        self.assertRegex(text, r"(?ms)base_url:.*?required:\s*true")
        self.assertRegex(text, r"(?ms)base_url:.*?type:\s*string")
        self.assertRegex(text, r"(?m)^\s*all:\s*$")
        self.assertIn("description: Check every localized patch detail page", text)
        self.assertRegex(text, r"(?ms)all:.*?default:\s*false")
        self.assertRegex(text, r"(?ms)all:.*?required:\s*true")
        self.assertRegex(text, r"(?ms)all:.*?type:\s*boolean")
        self.assertRegex(text, r"(?m)^\s*schedule:\s*$")
        self.assertIn("cron: '30 23 * * *'", text)
        self.assertIn("cron: '30 11 * * *'", text)

    def test_workflow_permissions_concurrency_and_runtime_contract(self):
        text = self.workflow_text()

        self.assertRegex(text, r"(?ms)permissions:\s*\n\s*contents:\s*read")
        self.assertIn("concurrency:", text)
        self.assertIn("runs-on: ubuntu-latest", text)
        self.assertIn("timeout-minutes: 10", text)
        self.assertIn("actions/checkout@v4", text)
        self.assertIn("actions/setup-python@v5", text)
        self.assertIn("python-version: '3.12'", text)
        self.assertNotIn("pip install", text)
        self.assertNotIn("npm install", text)
        self.assertNotIn("npm ci", text)

    def test_workflow_runs_verifier_without_repository_mutations(self):
        text = self.workflow_text()
        lowered = text.lower()

        self.assertIn("scripts/verify_live_patch_seo.py", text)
        self.assertRegex(text, r'--base-url\s+"\$BASE_URL"')
        self.assertNotIn("git add", lowered)
        self.assertNotIn("git commit", lowered)
        self.assertNotIn("git push", lowered)
        self.assertNotIn("data/internal", text)
        self.assertNotIn("public/data", text)

    def test_scheduled_runs_do_not_force_all_mode(self):
        text = self.workflow_text()

        all_flag_lines = [
            line.strip()
            for line in text.splitlines()
            if "--all" in line and not line.strip().startswith("#")
        ]
        self.assertTrue(all_flag_lines, "workflow must support optional --all")
        self.assertTrue(
            any(
                "github.event_name" in line
                and "workflow_dispatch" in line
                and "inputs.all" in line
                for line in text.splitlines()
            ),
            "--all must be gated to workflow_dispatch input",
        )
        self.assertFalse(
            any(re.fullmatch(r".*verify_live_patch_seo\.py.*--all.*", line) for line in all_flag_lines),
            "scheduled verifier command must not hard-code --all",
        )


if __name__ == "__main__":
    unittest.main()
