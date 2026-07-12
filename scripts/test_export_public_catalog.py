#!/usr/bin/env python3
import unittest

from export_public_catalog import enrich_public_items


class ExportPublicCatalogTests(unittest.TestCase):
    def test_legacy_mayhem_rows_receive_stable_cdragon_ids(self):
        source = {
            "mayhemExclusive": [
                {"slug": "atmas-reckoning", "name": "Atma's Reckoning"},
                {"slug": "wooglets-witchcap", "name": "Wooglet's Witchcap"},
                {"slug": "unknown", "name": "Unknown"},
            ],
            "items": [],
        }
        result = enrich_public_items(source)
        self.assertEqual(result["mayhemExclusive"][0]["id"], 223039)
        self.assertEqual(result["mayhemExclusive"][1]["id"], 228002)
        self.assertNotIn("id", result["mayhemExclusive"][2])
        self.assertNotIn("id", source["mayhemExclusive"][0])


if __name__ == "__main__":
    unittest.main()
