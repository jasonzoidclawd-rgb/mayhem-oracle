"""`meta.json` must name the statistical patch and the catalog patch separately.

One string cannot mean both "what patch the observed statistics came from" and
"what mechanics are currently being served". It did, and the two diverged:
arammayhem's win-rate feed sat on 26.16 while the shipped catalog was rebuilt
from CDragon 16.17 (= 26.17). Consumers then had to pick a wrong answer --
the footer understated the game version, and the telemetry loader compared live
16.17 matches against 26.16 and quarantined all of them.

  patch          statistical/feed source patch (arammayhem observations)
  catalog_patch  display patch of the Riot/CDragon mechanics actually shipped

Neither is derived from the other, and neither is derived by arithmetic.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from export_public_catalog import build_public_meta


class PublicMetaPatchSemanticsTests(unittest.TestCase):
    def _internal(self, tmp: str, *, feed_patch: str, riot_display: str | None) -> Path:
        internal = Path(tmp)
        (internal / "meta.json").write_text(
            json.dumps({
                "patch": feed_patch,
                "scraped_at": "2026-08-29T00:00:00Z",
                "source": "https://arammayhem.com",
            }),
            encoding="utf-8",
        )
        if riot_display is not None:
            (internal / "patch-metadata.json").write_text(
                json.dumps({
                    "patch": riot_display,
                    "patches": [{"version": riot_display}, {"version": "26.16"}],
                }),
                encoding="utf-8",
            )
        return internal

    def test_divergent_case_names_both_patches(self):
        """The live 2026-08-29 state: feed lagging one patch behind mechanics."""
        with tempfile.TemporaryDirectory() as tmp:
            internal = self._internal(tmp, feed_patch="26.16", riot_display="26.17")

            meta = build_public_meta(internal)

            self.assertEqual(meta["patch"], "26.16")
            self.assertEqual(meta["catalog_patch"], "26.17")

    def test_the_statistical_feed_is_never_dragged_forward(self):
        """Relabelling 26.16 observations as 26.17 would fake their freshness."""
        with tempfile.TemporaryDirectory() as tmp:
            internal = self._internal(tmp, feed_patch="26.16", riot_display="26.17")

            meta = build_public_meta(internal)

            self.assertNotEqual(meta["patch"], meta["catalog_patch"])
            self.assertEqual(meta["scraped_at"], "2026-08-29T00:00:00Z")
            self.assertEqual(meta["source"], "https://arammayhem.com")

    def test_fields_stay_independent_when_they_agree(self):
        """Equal values must be two observations, not one copied into the other."""
        with tempfile.TemporaryDirectory() as tmp:
            internal = self._internal(tmp, feed_patch="26.17", riot_display="26.17")

            meta = build_public_meta(internal)

            self.assertEqual(meta["patch"], "26.17")
            self.assertEqual(meta["catalog_patch"], "26.17")

    def test_catalog_patch_is_absent_rather_than_guessed(self):
        """With no Riot authority we do not know it, and must not invent it."""
        with tempfile.TemporaryDirectory() as tmp:
            internal = self._internal(tmp, feed_patch="26.16", riot_display=None)

            meta = build_public_meta(internal)

            self.assertEqual(meta["patch"], "26.16")
            self.assertIsNone(meta.get("catalog_patch"))

    def test_catalog_patch_never_comes_from_the_feed(self):
        """Guards against a future 'default to meta.patch' convenience.

        If the Riot authority is present, catalog_patch follows it even when
        that means disagreeing with the feed -- which is the entire point.
        """
        with tempfile.TemporaryDirectory() as tmp:
            internal = self._internal(tmp, feed_patch="26.9", riot_display="26.17")

            meta = build_public_meta(internal)

            self.assertEqual(meta["catalog_patch"], "26.17")


if __name__ == "__main__":
    unittest.main()
