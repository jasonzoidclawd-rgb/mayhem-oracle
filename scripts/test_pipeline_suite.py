"""Keep every repository pipeline test explicitly classified."""

from pathlib import Path
import unittest

from pipeline_suite import EXCLUDED, MEMBERS


SCRIPTS_DIR = Path(__file__).parent


class PipelineSuiteMembershipTest(unittest.TestCase):
    def test_every_script_test_is_classified_exactly_once(self):
        discovered = {path.stem for path in SCRIPTS_DIR.glob("test_*.py")}
        classified = set(MEMBERS) | set(EXCLUDED)
        self.assertEqual(discovered, classified)

    def test_every_classified_entry_exists(self):
        for module in [*MEMBERS, *EXCLUDED]:
            with self.subTest(module=module):
                self.assertTrue((SCRIPTS_DIR / f"{module}.py").is_file())

    def test_members_and_exclusions_are_disjoint(self):
        self.assertEqual(set(MEMBERS) & set(EXCLUDED), set())

    def test_every_exclusion_has_a_reason(self):
        for module, reason in EXCLUDED.items():
            with self.subTest(module=module):
                self.assertTrue(reason.strip())


if __name__ == "__main__":
    unittest.main()
