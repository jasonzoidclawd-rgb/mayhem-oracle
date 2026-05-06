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

step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$1"; }

step "1/9  arammayhem.com  →  champions/augments/combos/meta"
python3 scripts/scrape_arammayhem.py

step "2/9  CommunityDragon  →  abilities/items"
python3 scripts/scrape_community_dragon.py

step "3/9  Data Dragon base stats  →  champions.json (enrich)"
python3 scripts/scrape_base_stats.py

step "4/9  CommunityDragon ability stats  →  abilities.json (enrich)"
npx --yes tsx scripts/scrape_ability_stats.ts

step "5/9  LoL Wiki augment descriptions  →  augments.json (enrich)"
python3 scripts/scrape_wiki_augments.py

step "6/9  LoL Wiki item passives  →  items.json (enrich)"
python3 scripts/enrich_wiki.py

step "7/9  arammayhem.com /patch-notes  →  patch-notes.json"
python3 scripts/scrape_patch_notes.py

step "8/9  classify champions/augments  →  kit_tags"
python3 scripts/classify_champions.py
python3 scripts/classify_augments.py

step "9/9  generate pool rules  →  pool-rules.json"
python3 scripts/generate_pool_rules.py

NEW_PATCH=$(python3 -c "import json; print(json.load(open('$META'))['patch'])")

# Clear Next.js cache — large data rewrites corrupt HMR state if the dev server was running.
rm -rf .next

printf "\n\033[1;32m✓ Data refresh complete: %s → %s\033[0m\n" "$OLD_PATCH" "$NEW_PATCH"
printf "  Next: review 'git diff public/data/', run 'npm run build', commit.\n"
