# Competitive ARAM Mayhem Assistant PRD

Date: 2026-05-02
Source project studied: /Users/jason/Desktop/mayhem-oracle
Working title: Mayhem Draft Coach

## 1. Executive Summary

Build a competing League of Legends ARAM Mayhem companion focused on fast, transparent, set-aware in-match decision support. The product should not clone Mayhem Oracle’s branding or exact implementation. It should compete by solving a sharper user problem: when a player sees three offered augments, which should they pick, should they reroll, and why?

The recommended product is a mobile-first PWA, with a possible compliant desktop companion later. MVP should prioritize a “3-card picker” workflow, champion-specific recommendations, owned-augment state, same-set bonus planning, reroll expected-value guidance, shop-availability timing, confidence labels, and clear recommendation explanations.

Primary positioning:

“A transparent, set-aware ARAM Mayhem draft assistant that helps players choose among offered augments, plan future set paths, and understand every recommendation — without requiring a risky desktop overlay.”

## 2. Background and Findings

### 2.1 Mayhem Oracle project findings

The local Mayhem Oracle project is a Next.js 15 PWA using TypeScript, React 19, Tailwind CSS v4, and next-intl. It uses static JSON data under public/data and appears to be designed for Vercel-style static deployment.

Observed user-facing routes:

- /
- /tier-list
- /champions
- /champions/[slug]
- /augments
- /items
- /items/[identifier]
- /damage-sim
- /patch-notes

Observed strengths:

- Strong ARAM Mayhem niche focus.
- Champion tier lists and champion pages.
- Augment pages and augment set grouping.
- Oracle Score model combining win rate, rarity/tier, set synergy, combos, traps, and system-breaker bonuses.
- Smart-tailored pool filtering based on champion tags and exclusions.
- Multilingual support for en, zh-TW, zh-CN, ja, ko.
- Patch notes and data-source awareness.
- PWA manifest and installable-app posture.
- Separate Tauri overlay work in overlay/ with OCR and live-client probing.

Observed weaknesses / opportunities:

- Main web app is mostly a reference/catalog site, not a live decision workflow.
- No obvious web route where a user enters current champion + owned augments + three offered augments to get a direct pick/reroll answer.
- Probability and set-path logic exist mostly in overlay code, not clearly surfaced in the main web UX.
- Overlay is technically ambitious but fragile: macOS-heavy, fixed OCR regions, Traditional Chinese Tesseract dependency, and duplicated scoring logic.
- PWA appears installable but lacks a true service worker/offline cache.
- GitHub scheduled data workflow appears narrower than the local full update-data.sh pipeline.
- Several UI areas appear hardcoded in English despite broad locale support.
- Champions page exists but is not in the primary navbar.
- Score model is heuristic and could benefit from confidence labels and source provenance.

### 2.2 Competitive landscape

Direct and adjacent competitors:

- Blitz.gg ARAM Mayhem Augments
  - Strong in-game overlay positioning.
  - Likely strong install base.
  - Opportunity: more transparent reasoning, reroll EV, set-path planning, safer no-install PWA positioning.

- METAsrc Mayhem
  - Champion tier and build pages.
  - Publicly notes that Riot has not exposed ARAM Mayhem data through API, so some data may be compiled from ARAM/Arena proxies.
  - Opportunity: clearly label data provenance and focus on Mayhem-native decision logic.

- arammayhem.com
  - Strong public data/reference site for champions, augments, combos, and patch notes.
  - Opportunity: compete on workflow, explanation, personalization, and speed rather than raw data display.

- Mobalytics / U.GG / Games.gg / community guides
  - Good SEO and beginner education.
  - Mostly guide/article/list format.
  - Opportunity: interactive assistant instead of static content.

### 2.3 ARAM Mayhem mode-specific rules findings

Source reviewed: League of Legends Wiki, ARAM: Mayhem, `https://wiki.leagueoflegends.com/en-us/ARAM:_Mayhem#Show`.

Mode foundation:

- ARAM Mayhem is regular ARAM with an additional Mayhem rules layer.
- Draft is all-random, blind, no bans.
- Supported maps listed by the wiki are Howling Abyss, Butcher’s Bridge, and Koeshin’s Crossing.
- Runes are entirely disabled, though some keystone-like effects can appear through augments.
- Exhaust is disabled.
- Ignite counts as a Burn source.

Augment selection rules:

- Each player receives four standard augment selections.
- Selection timing is level 3 / game start, then levels 7, 11, and 15.
- Each selection screen offers exactly three augments and the player picks one.
- Every player is offered the same augment tier on a given selection screen.
- The tier is random each screen, with the special rule that the first and second selection screens cannot both be Silver-tier in the same game.
- Each offering can be rerolled at most once, giving up to six visible choices per selection screen.
- Normal rerolls preserve the same tier.
- Golden Rerolls, unlocked through the Mayhem Progression Track, may appear for Silver or Gold selections and reroll one offering into an augment one tier higher.
- Augment selection screens appear only when the shop is enabled: the player is dead, in shop range after respawn, or able to recall through the Cheating augment.
- If the player reaches selection level while shop is unavailable, the selection is delayed until shop access becomes available.
- If multiple selections are pending, they appear sequentially in order.
- Hiding the augment selection screen prevents shop use while it is hidden.

Set and slot rules:

- Augments have Silver, Gold, and Prismatic rarities.
- Some augments belong to themed sets.
- Having two or more augments from the same set activates a set bonus.
- A fifth augment slot can be filled only by select special augments.

Mode-specific combat/economy rules relevant to recommendations:

- Critical strike chance above 100% converts into adaptive stats: each excess 1% critical chance grants 0.45 bonus Attack Damage or 0.75 Ability Power.
- Attack speed cap is 5.0.
- All champions gain level-scaling base health, mana or energy regeneration, and bonus armor / magic resistance, with the wiki noting a current bug where ranged champions do not receive the listed armor/MR bonus.
- Combo Breaker grants stacking tenacity after immobilizing crowd control and cleanses/protects a champion if they have been immobilized for 5 of the last 7 seconds.
- All champions gain Presence of Mind.
- Health relic area heal and mana restore are increased to 22% missing health/mana.
- Super-minion, siege-minion aura, turret, nexus, and inhibitor-turret rules differ from regular ARAM and should be treated as mode context, not recommendation-core data for the MVP.
- The wiki lists additional champion-, item-, and rune-specific overrides layered on top of regular ARAM overrides. Champion-specific overrides should affect P0 recommendations when they materially change an augment’s value for the selected champion; otherwise they should appear as reference/confidence notes.

Product implications:

- The MVP picker should model the four selection rounds as level 3, 7, 11, and 15, not generic “early/mid/late” rounds.
- The picker should require exactly three offered augments for a normal evaluation.
- Reroll guidance is an MVP feature. It must respect same-tier normal rerolls, distinguish Golden Reroll cases from normal rerolls, and remain qualitative rather than falsely precise.
- Shop-availability timing is an MVP feature. The picker should let users represent whether a selection is immediately available, delayed until death/respawn shop range, enabled by Cheating recall, or queued behind another pending selection.
- Because everyone gets the same tier on a screen, tier should be a screen-level input or derived from the three offered augments, not treated as independent per-card randomness.
- The first-two-screens-not-both-Silver rule should inform MVP reroll EV and future offer modeling.
- Set planning should use the known rule “two or more from the same set activates a set bonus”; do not invent 3-piece or 4-piece thresholds unless verified for a specific set or patch.
- Mode-specific stats can materially affect recommendations for crit overflow, attack-speed scaling, burn, crowd-control chaining, mana/energy sustain, and champion-specific overrides.
- Recommendation explanations should label these as “mode rule” signals when they influence advice.
- Mode-rule effects should use a hybrid data strategy: curated metadata for high-impact interactions plus clearly labeled inference from champion and augment text. Inferred signals must carry lower confidence until curated or verified.

### 2.4 Data and policy constraints

- Riot does not appear to expose official ARAM Mayhem data through a public API.
- Any product will need a careful data strategy: public pages, CommunityDragon assets, patch notes, curated tags, community reports, and clearly labeled proxy stats where used.
- Riot third-party app policy and Overwolf compliance rules make live overlays and in-game “action dictation” sensitive.
- Safest MVP posture is a standalone PWA/manual companion: no client injection, no hidden information, no automation, no memory reading.

## 3. Problem Statement

ARAM Mayhem players must make fast, high-impact augment choices under time pressure. Existing tools mostly provide global tier lists or static champion pages. They often do not answer the actual in-game question:

“Given my champion, current round, owned augments, and these three offered augments, what should I take, should I reroll, and what future set paths does this enable?”

Users also struggle to trust recommendations because many tools do not explain whether advice comes from win-rate data, patch notes, champion mechanics, set synergies, community-discovered interactions, or generic heuristics.

## 4. Goals and Non-Goals

### 4.1 Goals

P0 goals:

- Let a user get a recommendation in under 10 seconds after seeing three offered augments.
- Rank offered augments for a selected champion.
- Include owned augment state and set progress.
- Explain each recommendation in plain language.
- Provide qualitative reroll expected-value guidance, including normal rerolls and Golden Rerolls.
- Model shop-availability timing when a selection is delayed or queued.
- Display data freshness, patch version, and confidence labels.
- Work well on mobile as a PWA and desktop browser.
- Include Riot legal disclaimer and avoid official-affiliation claims.

P1 goals:

- Model same-set bonus activation odds and future path value.
- Add offline cache for core data and recent champion selection.
- Add multi-language augment search aliases.
- Add champion pages and augment pages as supporting reference surfaces.
- Add patch-diff impact badges.

P2 goals:

- Add team-comp context.
- Add community-submitted interaction notes with moderation.
- Add OCR/screenshot helper only if compliant and non-invasive.
- Evaluate desktop companion/overlay only after compliance review.

### 4.2 Non-Goals

- Do not clone Mayhem Oracle branding, UI, or exact scoring constants.
- Do not build a client-injecting overlay for MVP.
- Do not automate player inputs.
- Do not expose hidden information.
- Do not claim Riot endorsement.
- Do not rely solely on one scraped data source without health checks.
- Do not optimize for full general League builds before solving the ARAM Mayhem augment decision loop.

## 5. Target Users

### Persona A: In-match optimizer

- Plays ARAM Mayhem actively.
- Needs fast answers during augment rounds.
- Values win-rate and synergy.
- Has little patience for long pages.

Core need:

“I see three choices. Tell me the best pick and whether rerolling is worth it.”

### Persona B: Theorycrafter

- Studies champion-specific augment interactions.
- Wants reasoning, set planning, and patch changes.
- Will inspect confidence and source details.

Core need:

“Show me why this augment is good, what set path it supports, and what changed this patch.”

### Persona C: Casual player

- Wants safe recommendations and trap avoidance.
- May not know every augment name or set bonus.
- Uses mobile or second monitor.

Core need:

“Help me avoid bad picks and find fun broken combos.”

### Persona D: Multilingual player

- Uses localized game client names.
- Needs English/CN/KR/JP/TW search aliases.

Core need:

“Let me search the augment name I see in my client.”

## 6. Product Requirements

### 6.1 P0: 3-Card Draft Assistant

Primary flow:

1. User selects champion.
2. User selects selection round: level 3 / game start, level 7, level 11, or level 15.
3. User confirms current augment tier if not inferable from the offered augments.
4. User selects owned augments, if any.
5. User enters exactly three offered augments.
6. User enters available reroll context: normal rerolls remaining, Golden Reroll availability if applicable, and whether rerolled choices have already been seen.
7. User enters shop-availability context if the selection is delayed or queued: currently available, delayed until death/respawn shop range, available via Cheating recall, or queued behind another pending selection.
8. Product ranks the options and returns:
   - best pick
   - safe pick
   - high-ceiling pick, if different
   - reroll expected-value guidance
   - set impact
   - explanation bullets
   - confidence level

Functional requirements:

- Champion selector supports fuzzy search and localized names.
- Augment selector supports fuzzy search, aliases, rarity, and localized names.
- Owned augment state persists locally for the session.
- Offered augment cards can be changed quickly without resetting champion state.
- Recommendation output appears without page reload.
- Explanations are concise by default with expandable details.
- Shop-availability timing affects guidance copy and round state; delayed or queued selections should not be presented as if they were immediately actionable.
- Reroll EV is qualitative and bounded: the app should compare the visible best option against expected same-tier normal reroll outcomes, one-tier-higher Golden Reroll opportunities when available, owned augment/set paths, and champion-specific traps/synergies.

Recommendation card fields:

- Rank: 1, 2, 3.
- Recommendation label: Best / Safe / High Ceiling / Avoid.
- Score band, not necessarily raw score.
- Reroll EV stance: Keep / Reroll if chasing / Reroll recommended / Golden Reroll attractive / Do not reroll.
- Shop timing: Available now / Delayed until shop access / Cheating recall available / Pending selections queued.
- Set effect: activates same-set bonus, progresses set path, opens future path, conflicts, no set relevance.
- Main reasons: 2-4 bullets.
- Confidence: High / Medium / Low.
- Source notes: stats, mechanics, curated, community, proxy.

Acceptance criteria:

- A user can complete champion + 3 augment selection in under 10 seconds after first use.
- Recommendation updates within 200ms after selecting the third augment on typical desktop and under 500ms on mobile.
- If an augment has known champion-specific trap status, it is clearly flagged.
- If a champion-specific mode override materially changes recommendation value, it is reflected in the score and explanation.
- If shop availability delays or queues a selection, the UI states that timing explicitly.
- If data is stale or low-confidence, the product says so.

### 6.2 P0: Scoring and Explanation Engine

The scoring engine should be transparent and source-aware.

Inputs:

- Champion.
- Exactly three offered augments.
- Owned augments.
- Selection round: level 3 / game start, level 7, level 11, or level 15.
- Screen augment tier: Silver, Gold, or Prismatic.
- Reroll context: normal rerolls remaining, already-seen rerolled offers if available, and Golden Reroll availability for Silver/Gold screens.
- Shop-availability state: available now, delayed until shop access, Cheating recall available, or queued pending selection.
- Optional playstyle mode.
- Data freshness and source confidence.
- Applicable curated and inferred mode-rule signals, such as crit overflow, attack-speed cap, Ignite/Burn, Combo Breaker relevance, Presence of Mind sustain, and champion-specific overrides.

Core scoring dimensions:

- Champion mechanic fit.
- Augment rarity/tier context.
- Known champion-augment synergies.
- Known traps / anti-synergies.
- Champion-specific Mayhem overrides when they materially change augment value.
- Set progression and same-set bonus activation value.
- Current owned augment state.
- Reroll EV relative to visible offers, tier rules, Golden Reroll availability, owned augment state, and available pool estimates.
- Shop-availability timing and pending-selection sequencing.
- Mode-specific mechanics that change augment value, especially crit overflow, attack-speed cap, Burn-source interactions, Crowd Control / Combo Breaker relevance, and champion-specific overrides.
- General augment strength.
- Patch recency / invalidation status.
- Confidence and sample quality.

Recommendation modes:

- Balanced / recommended default.
- Safest pick.
- Highest ceiling.
- Set-chase mode.
- Beginner-safe mode.
- Fun/chaos mode.

Requirement:

- Explanations must be generated from the same signals that drive the recommendation. Do not provide generic text disconnected from scoring.

Acceptance criteria:

- Every recommendation has at least two concrete reasons.
- The user can expand a recommendation to see score components.
- Reroll EV details identify whether the advice is based on same-tier normal reroll, Golden Reroll upgrade potential, set chasing, or anti-synergy avoidance.
- Shop timing details identify whether the selection is actionable now, delayed, or queued.
- Low-confidence recommendations are visibly labeled.

### 6.3 P0: Data Freshness and Provenance

Functional requirements:

- Show current supported patch.
- Show last successful data update timestamp.
- Show source confidence per major data category.
- Flag stale data if older than configured threshold.
- Store source provenance per augment/champion recommendation.

Data categories:

- Champion metadata.
- Augment metadata.
- Set membership.
- Patch notes.
- Champion-augment interactions.
- Trap notes.
- Curated mode-rule and champion-override tags.
- Inferred mode-rule/champion-augment signals with explicit lower-confidence provenance.
- Proxy/global stats.
- Community verified notes.

Acceptance criteria:

- Product header or footer always includes patch and last updated timestamp.
- Recommendation details show whether a claim is data-backed, curated, community-reported, or inferred.
- Broken or missing data source does not silently produce confident recommendations.

### 6.4 P0: Mobile-First PWA

Functional requirements:

- Installable PWA with manifest.
- Responsive layout optimized for one-thumb mobile use.
- Recently selected champion and owned augment state persisted locally.
- Fast local search over champions and augments.
- Riot disclaimer in footer/about.

Acceptance criteria:

- Main 3-card picker is usable at 390px viewport width.
- No critical flow requires hover.
- Product works as a normal browser site with no install.

### 6.5 P0: Reroll Expected Value

Functional requirements:

- Estimate whether using a reroll is beneficial based on:
  - current offered options
  - champion-tailored pool
  - current screen tier
  - normal reroll behavior: same-tier replacement only
  - Golden Reroll behavior: one offered Silver/Gold augment may upgrade by one tier when available
  - owned augments
  - target set paths
  - remaining rerolls, if known
  - first-two-screens tier constraint: the first and second selections cannot both be Silver-tier
- Output should be qualitative, not falsely precise.

Example outputs:

- “Keep: current best option is already above expected reroll outcome.”
- “Reroll if chasing Firecracker same-set activation; otherwise take X.”
- “Reroll recommended: all visible options are low-confidence or anti-synergistic.”

Acceptance criteria:

- Reroll recommendation is shown for every 3-card evaluation.
- Reroll explanation references at least one concrete factor.

### 6.6 P0: Shop-Availability Timing

Functional requirements:

- Let the user mark the current selection as available now, delayed until shop access, available through Cheating recall, or queued behind another pending selection.
- Explain that augment selection screens appear only when shop is enabled and that delayed selections are shown once shop access becomes available.
- If multiple selections are pending, preserve selection order in the UI and explanations.
- Do not require game-client integration or automation; this is a manual state input for the PWA.

Acceptance criteria:

- The recommendation output displays a clear timing status for the current selection.
- Delayed or queued selections are not described as immediately actionable.
- Cheating recall support appears only as a user-selected context flag or verified augment-owned state.

### 6.7 P1: Set Path Planner

Functional requirements:

- Track owned set pieces.
- Highlight when a pick activates or preserves a same-set bonus under the verified “two or more from the same set” rule.
- Estimate realistic future set paths without inventing unverified 3-piece or 4-piece thresholds.
- Warn against low-probability over-chasing.

Acceptance criteria:

- If an offered augment activates or strengthens a same-set bonus, that is shown above generic score reasoning.
- If a lower-ranked augment is recommended because it activates or improves a same-set path, explanation explicitly says so.

### 6.8 P1: Champion and Augment Reference Pages

Champion page requirements:

- Best augments by rarity.
- Best set paths.
- Traps and anti-synergies.
- System-breaker interactions.
- Patch changes affecting recommendations.
- Recommended playstyle modes.

Augment page requirements:

- Best champions.
- Bad/trap champions.
- Set membership.
- Known interactions.
- Patch history.
- Confidence/source notes.

Acceptance criteria:

- Reference pages link back into the 3-card picker with champion/augment prefilled.

### 6.9 P1: Offline Cache

Functional requirements:

- Cache app shell and current patch data.
- If offline, show offline mode and data timestamp.
- Allow champion and augment lookup while offline.

Acceptance criteria:

- After first load, user can open the app offline and use the core picker with cached data.

### 6.10 P2: Community Interaction Notes

Functional requirements:

- Users can submit champion-augment interaction notes.
- Submissions enter moderation queue.
- Notes have status: unverified, community-reported, verified, deprecated.
- Patch changes can mark notes as stale.

Acceptance criteria:

- Unverified community notes are never displayed with the same confidence as curated/verified notes.

### 6.11 P2: Team Context

Functional requirements:

- Optional allied/enemy champion entry.
- Team needs tags: engage, peel, AP/AD balance, tank shred, anti-heal, poke, sustain.
- Recommendations can include team-context modifiers.

Acceptance criteria:

- Team context is optional and never slows the default 3-card picker.

## 7. UX Requirements

### 7.1 Core screen layout

Top section:

- Champion selector.
- Round/tier selector.
- Owned augment chips.

Middle section:

- Three offered augment slots.
- Each slot supports search, rarity filter, and recent picks.

Bottom section:

- Ranked recommendation summary.
- Reroll guidance.
- Set-path warning/opportunity.
- Explanation accordion.

### 7.2 UX principles

- One decision per screen.
- Fast input over visual density.
- Explain first in one sentence, details second.
- Use confidence labels to avoid false certainty.
- Make stale data impossible to miss.
- Keep in-match workflow separate from browsing/reference pages.

### 7.3 Example recommendation

Champion: Brand
Owned: Burn-related augment
Offered: Magic Missile, Bread and Butter, Random defensive augment

Output:

Best pick: Magic Missile
Why:

- Strong mechanic fit with Brand’s repeated spell hits and DoT pattern.
- Advances Firecracker set path toward a 2-piece breakpoint.
- Higher ceiling than Bread and Butter for damage-focused Brand.
- Confidence: Medium-high, based on mechanics + curated interaction notes.

Reroll:

Do not reroll. Current top option is already above expected reroll quality unless chasing a specific Prismatic.

## 8. Technical Requirements

### 8.1 Suggested architecture

Frontend:

- Next.js or equivalent React framework.
- TypeScript.
- PWA support with real service worker/offline cache.
- Local-first interaction state using localStorage/IndexedDB.

Data layer:

- Static versioned JSON data per patch.
- Schema validation for every data artifact.
- Source provenance embedded in records.
- Data health dashboard.

Scoring:

- Shared scoring package used by web app and any future companion.
- Unit tests for scoring edge cases.
- Snapshot tests for top champion recommendations after each patch.
- Explanation engine coupled to scoring components.

Pipeline:

- Full scheduled data update pipeline, not partial updates.
- Source health checks.
- Patch diff detection.
- Automated stale-data warning.
- CI checks: lint, tests, typecheck, production build, data schema validation.

### 8.2 Data schema concepts

Champion:

- id, slug, names by locale.
- classes/tags.
- mechanics tags.
- damage profile.
- resource type.
- patch-specific balance notes.

Augment:

- id, slug, names by locale.
- rarity/tier.
- set membership.
- text by locale.
- mechanics tags.
- exclusions.
- source provenance.
- patch status.

Interaction note:

- champion id.
- augment id.
- rating: synergy, neutral, trap.
- confidence.
- source type.
- source URL or internal note id.
- patch introduced / patch last verified.
- explanation.

Recommendation result:

- option id.
- rank.
- score band.
- labels.
- reasons.
- components.
- confidence.
- reroll stance.

## 9. Compliance and Legal Requirements

- Include Riot legal disclaimer on all pages.
- Do not imply Riot endorsement.
- Do not use Riot trademarks in product name beyond descriptive references where legally allowed.
- Do not automate gameplay actions.
- Do not read hidden game information.
- Avoid client injection and memory reading.
- If building an overlay later, perform Riot/Overwolf compliance review before release.
- Keep MVP as manual-input PWA/reference tool.

## 10. Metrics

Activation:

- % of visitors who complete first 3-card evaluation.
- Time from page load to first recommendation.

Engagement:

- Repeat evaluations per session.
- Return visits per patch.
- Champion pages opened from picker.
- Explanation accordions opened.

Quality:

- User helpfulness rating per recommendation.
- Reported wrong/trap recommendations.
- Community notes submitted and verified.

Freshness:

- Time from patch release to data update.
- Data pipeline success rate.
- Source health failures.

Performance:

- Picker interaction latency.
- Offline cache hit rate.
- Mobile Core Web Vitals.

## 11. MVP Backlog

### P0 tasks

1. Define champion, augment, interaction, and recommendation schemas.
2. Build seed data loader with schema validation.
3. Build champion selector with localized alias search.
4. Build augment selector with localized alias search.
5. Build owned augment state model.
6. Build 3-card picker UI.
7. Implement initial scoring engine.
8. Implement explanation generation from score components.
9. Implement basic set-progress detection.
10. Implement qualitative reroll EV guidance for normal rerolls and Golden Rerolls.
11. Implement manual shop-availability timing state and output copy.
12. Add champion-specific override and mode-rule signal support with curated/inferred provenance.
13. Add patch/version/freshness display.
14. Add Riot disclaimer and About page.
15. Add unit tests for scoring, set logic, reroll EV, shop timing, and mode-rule signals.
16. Add CI for lint/test/typecheck/build/data validation.
17. Ship PWA manifest and mobile layout.

### P1 tasks

1. Improve reroll EV with better pool probability estimates and post-launch calibration.
2. Add future set path planner.
3. Add champion reference pages.
4. Add augment reference pages.
5. Add offline service worker/cache.
6. Add patch diff badges.
7. Add confidence/source detail views.
8. Add full i18n for core UI.

### P2 tasks

1. Add community interaction submissions.
2. Add moderation workflow.
3. Add team-comp context.
4. Add screenshot/OCR helper feasibility spike.
5. Evaluate compliant desktop companion.

## 12. Risks and Mitigations

Risk: Data is stale or inaccurate.
Mitigation: visible freshness, source health checks, confidence labels, patch invalidation.

Risk: Scrapers break.
Mitigation: multiple sources, schema validation, pipeline alerts, manual override path.

Risk: Riot compliance concerns.
Mitigation: PWA/manual input MVP, no automation, no hidden info, legal disclaimer, overlay review later.

Risk: Recommendations feel untrustworthy.
Mitigation: explanation-first design, score breakdowns, provenance, confidence labels.

Risk: User input is too slow during match.
Mitigation: recent champion memory, fuzzy search, aliases, large tap targets, keyboard shortcuts, offline local data.

Risk: Competing brands have better SEO/install base.
Mitigation: differentiate on live decision workflow, reroll EV, set planning, trust, and transparency.

## 13. Open Questions

- What product name should be used to avoid Riot/trademark risk while remaining discoverable?
- Which data sources are acceptable for production use?
- Should proxy ARAM/Arena stats be used at all, or only curated Mayhem-specific data?
- What confidence model is sufficient for MVP?
- Which locales are required at launch?
- Should MVP support manual entry only, or allow screenshot paste/OCR outside the game client?
- What is the acceptable stale-data threshold after a patch?

Resolved product decisions:

- Reroll EV belongs in MVP, including normal rerolls and Golden Rerolls as qualitative guidance.
- Shop-availability timing belongs in MVP as manual state/timing context.
- Champion-specific mode overrides should influence P0 recommendations when materially relevant.
- Mode-rule effects should be supported through both curated metadata and inferred text-derived signals, with provenance/confidence labels.

## 14. Recommended MVP Definition

Ship the smallest version that is meaningfully different from Mayhem Oracle and competitor tier-list pages:

- Mobile-first PWA.
- Champion selector.
- Owned augment selector.
- Three offered augment slots.
- Ranked recommendation.
- Qualitative reroll EV guidance, including Golden Reroll cases.
- Same-set bonus/progression callouts.
- Shop-availability timing status.
- Champion-specific override and mode-rule signal labels.
- Concise explanation and confidence label.
- Patch/version/freshness display.
- Riot disclaimer.

This MVP directly addresses the live decision problem and establishes a defensible wedge: not another tier list, but a transparent ARAM Mayhem draft coach.
