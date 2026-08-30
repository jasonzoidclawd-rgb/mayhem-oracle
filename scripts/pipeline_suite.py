"""Run the explicitly classified data-pipeline and publication safety net."""

from pathlib import Path
import sys
import unittest


SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))

MEMBERS = [
    "test_assemble_augments",
    "test_augment_base_catalog",
    "test_augment_identity_resolver",
    "test_augment_wiki_feed",
    "test_build_tencent_feed",
    "test_cdragon_patch_pipeline",
    "test_cdragon_snapshot_diff",
    "test_check_data_freshness",
    "test_check_roster_coverage",
    "test_classify_augments",
    "test_enrich_locale_names",
    "test_export_public_catalog_meta",
    "test_patch_event_projection",
    "test_pipeline_suite",
    "test_public_bundle_boundary",
    "test_safe_http",
    "test_scrape_arammayhem",
    "test_scrape_base_stats",
    "test_scrape_patch_notes",
    "test_verify_patch_publish",
]

EXCLUDED = {
    "test_verify_live_auth_redirects": "post-deploy live-site verification tooling, not the data pipeline",
    "test_verify_live_entity_routes": "post-deploy live-site verification tooling, not the data pipeline",
    "test_verify_live_jsonld": "post-deploy live-site verification tooling, not the data pipeline",
    "test_verify_live_patch_seo": "post-deploy live-site verification tooling, not the data pipeline",
    "test_verify_live_seo_workflow": "post-deploy live-site verification tooling, not the data pipeline",
}


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromNames(MEMBERS)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
