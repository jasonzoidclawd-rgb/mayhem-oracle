"""Champion identity for locale enrichment must come from an authoritative key.

BUG-4: arammayhem moved its champion icons to a new CDN whose URLs end in the
IMAGE SIZE rather than the Riot champion key:

    old  .../champion-icons/63.png              -> 63  (Brand)          correct
    new  .../v1/champions/icons/aatrox/64.png   -> 64  (Lee Sin)        wrong

Every row on the new CDN ends in `/64.png`, so a trailing-number parser resolves
all 171 of them to Riot key 64 and 171 champions were published carrying Lee
Sin's zh-TW/zh-CN/ja/ko names. The pipeline printed "localized 173/173" and
exited 0, because a wrong-but-present name is indistinguishable from a right one
once the join has already happened.

The catalog already carries `champion_key`, written from Data Dragon's own
`info.key` by `scrape_base_stats.py` (step 7) before enrichment runs (step 10b).
That is the authority; the icon URL never was one.
"""

from __future__ import annotations

import unittest

from enrich_locale_names import champion_key, enrich


# Riot keys, from Data Dragon.
BRAND, LEE_SIN, VAYNE = "63", "64", "67"

NEW_CDN = "https://pub-2322c7068eed43b08bc0dddf6528d1e2.r2.dev/v1/champions/icons/{slug}/64.png"
OLD_CDN = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/{key}.png"


def name_maps() -> dict[str, dict[str, str]]:
    """Data Dragon localized names, keyed by Riot champion key."""
    return {
        "zh_TW": {BRAND: "布蘭德", LEE_SIN: "李星", VAYNE: "汎"},
        "zh_CN": {BRAND: "烈焰巨魔", LEE_SIN: "盲僧", VAYNE: "暗夜猎手"},
        "ja_JP": {BRAND: "ブランド", LEE_SIN: "リー・シン", VAYNE: "ヴェイン"},
        "ko_KR": {BRAND: "브랜드", LEE_SIN: "리 신", VAYNE: "베인"},
    }


def catalog() -> list[dict]:
    """Three champions as the catalog holds them at enrichment time.

    `champion_key` is already populated (step 7); the icons are the live new-CDN
    shape, which is what regressed.
    """
    return [
        {"slug": "brand", "name": "Brand", "champion_key": BRAND,
         "icon": NEW_CDN.format(slug="brand")},
        {"slug": "leesin", "name": "Lee Sin", "champion_key": LEE_SIN,
         "icon": NEW_CDN.format(slug="leesin")},
        {"slug": "vayne", "name": "Vayne", "champion_key": VAYNE,
         "icon": NEW_CDN.format(slug="vayne")},
    ]


class ChampionIdentityTests(unittest.TestCase):
    def test_identity_comes_from_champion_key_not_the_icon_url(self):
        """The regression, at the seam: same icon tail, different champions."""
        rows = catalog()
        self.assertEqual([champion_key(r) for r in rows], [BRAND, LEE_SIN, VAYNE])

    def test_new_cdn_icons_do_not_collapse_every_champion_onto_lee_sin(self):
        rows = catalog()
        enrich(rows, champion_key, name_maps())

        by_slug = {r["slug"]: r for r in rows}
        self.assertEqual(by_slug["brand"]["name_zh_TW"], "布蘭德")
        self.assertEqual(by_slug["vayne"]["name_zh_TW"], "汎")
        # Lee Sin's own names are correct BOTH before and after the fix, which is
        # exactly why the corruption looked plausible. Assert the other two.
        self.assertEqual(by_slug["leesin"]["name_zh_TW"], "李星")

        localized = [r["name_zh_TW"] for r in rows]
        self.assertEqual(
            len(set(localized)), len(rows),
            f"champion identity collapsed: {localized}",
        )

    def test_old_cdn_icon_shape_still_resolves(self):
        """The previous URL form must keep working; this is not a swap."""
        rows = [
            {"slug": "brand", "name": "Brand", "champion_key": BRAND,
             "icon": OLD_CDN.format(key=BRAND)},
        ]
        self.assertEqual(champion_key(rows[0]), BRAND)

    def test_a_row_with_no_authoritative_key_fails_closed(self):
        """Unknown identity must stay unlocalized, never borrow another champion."""
        rows = [{"slug": "mystery", "name": "Mystery",
                 "icon": NEW_CDN.format(slug="mystery")}]
        enriched = enrich(rows, champion_key, name_maps())

        self.assertEqual(enriched, 0)
        self.assertNotIn("name_zh_TW", rows[0])

    def test_duplicate_source_identity_is_rejected_not_last_write_wins(self):
        """Two catalog rows claiming one Riot key is a collapse in miniature."""
        rows = [
            {"slug": "brand", "name": "Brand", "champion_key": BRAND, "icon": ""},
            {"slug": "impostor", "name": "Impostor", "champion_key": BRAND, "icon": ""},
        ]
        with self.assertRaises(ValueError):
            enrich(rows, champion_key, name_maps())


if __name__ == "__main__":
    unittest.main()
