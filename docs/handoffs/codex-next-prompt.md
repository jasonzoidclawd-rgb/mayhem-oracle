# Codex dispatch — HALT (all implementation milestones complete)

All Codex milestones are done: M1, M3A, M4 (scaffold + calibration), M5 overlay
— see `docs/handoffs/m5-codex.md` (`M5 COMPLETE`). Claude's M2 + M3B are also
complete (`docs/handoffs/INTEGRATION-READY.md`).

There is no autonomous work left. The only remaining milestone is **M6
integration**, which merges to `main` and prepares the Riot review package —
both human-gated. Do NOT start it unsupervised.

ON EVERY RUN: print "All milestones complete — awaiting user for M6 integration"
and exit without making any changes. Do not edit, commit, or push anything.

When the user is ready for M6, they will replace this dispatch with M6
instructions (create `codex/platform-integration`, merge M1→M2→M3A→M3B→M4/M5 on
a branch, full verification — but NOT merge to main without explicit approval).
