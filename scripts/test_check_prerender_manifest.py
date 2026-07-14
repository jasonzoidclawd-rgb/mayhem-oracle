import unittest

from check_prerender_manifest import PrerenderManifestError, verify_prerender_manifest


class PrerenderManifestTests(unittest.TestCase):
    def manifest(self, routes):
        return {
            "routes": {route: {} for route in routes},
            "dynamicRoutes": {
                "/[locale]/champions/[slug]": {"fallback": False},
            },
        }

    def test_accepts_the_canonical_locale_roster_cross_product(self):
        routes = {
            "/en/champions/ahri",
            "/zh-TW/champions/ahri",
            "/en/champions/locke",
            "/zh-TW/champions/locke",
        }
        summary = verify_prerender_manifest(
            self.manifest(routes), ["ahri", "locke"], ["en", "zh-TW"]
        )
        self.assertEqual(summary["actual_champion_prerender_count"], 4)

    def test_fails_when_one_champion_prerender_is_missing(self):
        with self.assertRaisesRegex(PrerenderManifestError, "missing 1 route"):
            verify_prerender_manifest(
                self.manifest({"/en/champions/ahri"}),
                ["ahri"],
                ["en", "zh-TW"],
            )

    def test_fails_when_dynamic_params_fallback_is_enabled(self):
        manifest = self.manifest({"/en/champions/ahri"})
        manifest["dynamicRoutes"]["/[locale]/champions/[slug]"]["fallback"] = None
        with self.assertRaisesRegex(PrerenderManifestError, "fallback=false"):
            verify_prerender_manifest(manifest, ["ahri"], ["en"])


if __name__ == "__main__":
    unittest.main()
