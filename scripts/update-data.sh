#!/usr/bin/env bash
# Mayhem Oracle — per-patch data refresh
# Runs every scraper in dependency order. Stops on first failure.
#
# Usage:
#   ./scripts/update-data.sh
#   npm run update-data

set -euo pipefail

cd "$(dirname "$0")/.."

META=public/data/meta.json
OLD_PATCH=$(python3 -c "import json; print(json.load(open('$META'))['patch'])" 2>/dev/null || echo "unknown")
AUGMENT_SNAPSHOT=$(mktemp -t mayhem-augment-snapshot.XXXXXX)
trap 'rm -f "$AUGMENT_SNAPSHOT"' EXIT

step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$1"; }

step "1/11  snapshot augment classifications"
AUGMENT_SNAPSHOT="$AUGMENT_SNAPSHOT" python3 - <<'PY'
import json
import os
from pathlib import Path

path = Path("public/data/augments.json")
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

step "2/11  arammayhem.com  →  champions/augments/combos/meta"
python3 scripts/scrape_arammayhem.py

step "3/11  CommunityDragon  →  abilities/items"
python3 scripts/scrape_community_dragon.py

step "4/11  Data Dragon base stats  →  champions.json (enrich)"
python3 scripts/scrape_base_stats.py

step "5/11  CommunityDragon ability stats  →  abilities.json (enrich)"
npx --yes tsx scripts/scrape_ability_stats.ts

step "6/11  LoL Wiki augment descriptions  →  augments.json (enrich)"
python3 scripts/scrape_wiki_augments.py

step "7/11  LoL Wiki item passives  →  items.json (enrich)"
python3 scripts/enrich_wiki.py

step "8/11  arammayhem.com /patch-notes  →  patch-notes.json"
python3 scripts/scrape_patch_notes.py

step "9/11  restore augment classifications"
AUGMENT_SNAPSHOT="$AUGMENT_SNAPSHOT" python3 - <<'PY'
import json
import os
from pathlib import Path

snapshot = json.loads(Path(os.environ["AUGMENT_SNAPSHOT"]).read_text(encoding="utf-8"))
path = Path("public/data/augments.json")
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
        saved_flags = {k: v for k, v in saved["flags"].items() if k != "lifecycle"}
        aug.setdefault("flags", {}).update(saved_flags)
    restored += 1
path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
missing = sum(1 for a in data["augments"] if not a.get("kit_tags"))
print(f"Restored {restored} augments. Unclassified or universal: {missing}")
PY

step "10/11  classify champions/augments  →  kit_tags"
python3 scripts/classify_champions.py
python3 scripts/classify_augments.py --skip-classified --allow-partial
python3 - <<'PY'
import json
from pathlib import Path

data_dir = Path("public/data")
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

if champion_tagged == 0 or augment_tagged == 0 or missing_breakers:
    raise SystemExit(
        "classification validation failed: "
        f"champion kit_tags={champion_tagged}/{len(champions)}, "
        f"augment kit_tags={augment_tagged}/{len(augments)}, "
        f"missing system breakers={missing_breakers}"
    )
PY

step "11/11  generate pool rules  →  pool-rules.json"
python3 scripts/generate_pool_rules.py

NEW_PATCH=$(python3 -c "import json; print(json.load(open('$META'))['patch'])")

# Clear Next.js cache — large data rewrites corrupt HMR state if the dev server was running.
rm -rf .next

printf "\n\033[1;32m✓ Data refresh complete: %s → %s\033[0m\n" "$OLD_PATCH" "$NEW_PATCH"
printf "  Next: review 'git diff public/data/', run 'npm run build', commit.\n"
