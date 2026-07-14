import tempfile
import unittest
from pathlib import Path

from check_champion_static_imports import StaticImportError, verify_static_import_graph


class StaticChampionImportTests(unittest.TestCase):
    def test_rejects_a_transitive_next_headers_dependency(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            entry = root / "page.ts"
            helper = root / "helper.ts"
            entry.write_text('import "./helper";\n', encoding="utf-8")
            helper.write_text('import {cookies} from "next/headers";\ncookies();\n', encoding="utf-8")
            with self.assertRaises(StaticImportError):
                verify_static_import_graph(entry)

    def test_current_champion_graph_has_no_request_time_server_helpers(self):
        summary = verify_static_import_graph()
        self.assertEqual(summary["forbidden_dependency_count"], 0)


if __name__ == "__main__":
    unittest.main()
