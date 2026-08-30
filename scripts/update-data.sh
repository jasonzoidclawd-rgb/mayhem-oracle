#!/usr/bin/env bash
# Mayhem Oracle — per-patch data refresh
# Runs every scraper in dependency order. Stops on first failure.
#
# Usage:
#   ./scripts/update-data.sh
#   npm run update-data

set -euo pipefail

cd "$(dirname "$0")/.."

DATA_DIR=data/internal
export MAYHEM_DATA_DIR="$DATA_DIR"
META=$DATA_DIR/meta.json
mkdir -p "$DATA_DIR"
OLD_PATCH=$(python3 -c "import json; print(json.load(open('$META'))['patch'])" 2>/dev/null || echo "unknown")
AUGMENT_SNAPSHOT=$(mktemp -t mayhem-augment-snapshot.XXXXXX)
trap 'rm -f "$AUGMENT_SNAPSHOT"' EXIT

step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$1"; }

step "1/19  snapshot augment classifications"
AUGMENT_SNAPSHOT="$AUGMENT_SNAPSHOT" python3 - <<'PY'
import json
import os
from pathlib import Path

path = Path(os.environ["MAYHEM_DATA_DIR"]) / "augments.json"
data = json.loads(path.read_text(encoding="utf-8"))
snapshot = {
    a["slug"]: {k: a[k] for k in ("kit_tags", "set", "flags") if k in a}
    for a in data.get("augments", [])
}
Path(os.environ["AUGMENT_SNAPSHOT"]).write_text(
    json.dumps(snapshot, ensure_ascii=False),
    encoding="utf-8",
)
print(f"Snapshotted {sum(1 for v in snapshot.values() if v.get('kit_tags'))} classified augments")
PY

step "2/19  CommunityDragon  →  authoritative augment base catalog"
if ! python3 scripts/scrape_mayhem_augments_cdragon.py --base-catalog-only; then
  printf "\n\033[1;31m✗ CDragon augment base fetch failed; keeping committed augment artifacts and aborting rebuild.\033[0m\n" >&2
  exit 1
fi

step "3/19  CDragon/Wiki/Tencent/arammayhem  →  augment identity map"
python3 scripts/augment_identity_resolver.py

step "4/19  LoL Wiki augment feed  →  internal augment-wiki-feed/reports"
python3 scripts/augment_wiki_feed.py

step "5/19  Tencent 26.12 official notes  →  augment-tencent-feed"
python3 scripts/build_tencent_feed.py

step "6/19  arammayhem.com  →  internal champions/augment win-rate feed/combos/meta"
python3 scripts/scrape_arammayhem.py

step "7/19  Data Dragon  →  active champion identities + base stats"
python3 scripts/scrape_base_stats.py

step "8/19  CommunityDragon  →  internal abilities/items"
python3 scripts/scrape_community_dragon.py

step "9/19  CommunityDragon ability stats  →  internal abilities.json (enrich)"
npx --yes tsx scripts/scrape_ability_stats.ts

step "10/19 LoL Wiki item passives  →  internal items.json (enrich)"
python3 scripts/enrich_wiki.py

step "10b/19 Data Dragon  →  localized champion, ability & item names (enrich)"
python3 scripts/enrich_locale_names.py

step "11/19 Riot prose  →  patch title/date/canonical metadata only"
python3 scripts/scrape_patch_notes.py

# CommunityDragon is the structural source of truth for all three entities.
# Each lane promotes only after its full branch transaction validates; PBE never
# falls back to latest and latest is never relabeled as preview.
step "12/19 CommunityDragon latest  →  live snapshots + patch/hotfix events"
python3 scripts/cdragon_patch_pipeline.py --branch latest

step "13/19 CommunityDragon pbe  →  preview snapshots + lifecycle reconciliation"
python3 scripts/cdragon_patch_pipeline.py --branch pbe

step "14/19 patch-note removed augment tombstones  →  augment resolver input"
python3 scripts/apply_removed_augment_tombstones.py

step "15/19 assemble augments.json  →  resolved availability"
python3 scripts/assemble_augments.py

step "16/19 restore augment classifications"
AUGMENT_SNAPSHOT="$AUGMENT_SNAPSHOT" python3 - <<'PY'
import json
import os
from pathlib import Path

snapshot = json.loads(Path(os.environ["AUGMENT_SNAPSHOT"]).read_text(encoding="utf-8"))
path = Path(os.environ["MAYHEM_DATA_DIR"]) / "augments.json"
data = json.loads(path.read_text(encoding="utf-8"))
restored = 0
for aug in data.get("augments", []):
    saved = snapshot.get(aug["slug"])
    if not saved:
        continue
    if "kit_tags" in saved:
        aug["kit_tags"] = saved["kit_tags"]
    if saved.get("set") and not aug.get("set"):
        aug["set"] = saved["set"]
    if "flags" in saved:
        saved_flags = {
            k: v for k, v in saved["flags"].items()
            if k not in {
                "lifecycle",
                "availability_override",
                "availability_label",
                "availability_source",
                "availability_observed_at",
            }
        }
        aug.setdefault("flags", {}).update(saved_flags)
    restored += 1
path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
missing = sum(1 for a in data["augments"] if not a.get("kit_tags"))
print(f"Restored {restored} augments. Unclassified or universal: {missing}")
PY

step "17/19 classify internal champions/augments  →  kit_tags"
# --allow-partial: a handful of champions that fail deterministic derivation (and
# can't reach the optional LLM in CI) must NOT abort the whole refresh — an
# untagged champion degrades to a universal augment pool, which is far better
# than freezing all data (and blocking hotfix propagation). Mirrors augments.
python3 scripts/classify_champions.py --allow-partial
python3 scripts/classify_augments.py --skip-classified --allow-partial
python3 - <<'PY'
import json
from pathlib import Path

data_dir = Path("data/internal")
champions = json.loads((data_dir / "champions.json").read_text())["champions"]
augments = json.loads((data_dir / "augments.json").read_text())["augments"]

champion_tagged = sum(1 for c in champions if c.get("kit_tags"))
augment_tagged = sum(1 for a in augments if a.get("kit_tags"))
missing_breakers = [
    slug
    for slug in {
        "draw-your-sword", "jeweled-gauntlet", "master-of-duality",
        "mystic-punch", "tap-dancer", "marksmage",
        "slow-and-steady", "vulnerability",
    }
    if not next((a for a in augments if a.get("slug") == slug and a.get("flags", {}).get("system_breaker") is True), None)
]
locale_failures = []
for suffix in ("zh_TW", "zh_CN", "ja", "ko"):
    champion_field = f"name_{suffix}"
    augment_field = f"name_{suffix}"
    champion_count = sum(1 for c in champions if str(c.get(champion_field) or "").strip())
    augment_count = sum(1 for a in augments if str(a.get(augment_field) or "").strip())
    champion_coverage = champion_count / len(champions) if champions else 0
    augment_coverage = augment_count / len(augments) if augments else 0
    if champion_coverage < 0.9:
        locale_failures.append(f"champion {champion_field}={champion_count}/{len(champions)}")
    if augment_coverage < 0.8:
        locale_failures.append(f"augment {augment_field}={augment_count}/{len(augments)}")

if champion_tagged == 0 or augment_tagged == 0 or missing_breakers or locale_failures:
    raise SystemExit(
        "classification validation failed: "
        f"champion kit_tags={champion_tagged}/{len(champions)}, "
        f"augment kit_tags={augment_tagged}/{len(augments)}, "
        f"missing system breakers={missing_breakers}, "
        f"locale coverage failures={locale_failures}"
    )
PY

step "17b/19 generate internal pool rules  →  pool-rules.json"
python3 scripts/generate_pool_rules.py

step "17c/19 generate current internal combos  →  combos.json"
npx --yes tsx scripts/generate_internal_combos.ts

# Validate the internal catalog BEFORE it is published. The roster gate below
# reads public/data, so on its own it can only report corruption that has
# already shipped - BUG-4 reached public/data/champions.json that way while
# every step exited 0. Structural identity checks belong ahead of promotion.
step "18/19 internal catalog identity validation  →  pre-publish gate"
python3 scripts/check_roster_coverage.py --published-file data/internal/champions.json

step "19/19 export bounded public catalogs + patch/PBE presentation projections"
python3 scripts/export_public_catalog.py

step "20/20 Data Dragon  →  active champion roster coverage gate"
python3 scripts/check_roster_coverage.py

NEW_PATCH=$(python3 -c "import json; print(json.load(open('$META'))['patch'])")

# Clear Next.js cache — large data rewrites corrupt HMR state if the dev server was running.
rm -rf .next

printf "\n\033[1;32m✓ Data refresh complete: %s → %s\033[0m\n" "$OLD_PATCH" "$NEW_PATCH"
printf "  Next: review 'git diff data/internal public/data/', run 'npm run build', commit.\n"
