UPGRADE QUALITY now matches GemTD's "Upgrade chances" tree exactly: a nine-rung
odds track that can roll all the way up to Tesla-Prime.

## Upgrade-chances track reworked to GemTD's

The **UPGRADE QUALITY** (Refinement) mechanic was a six-rung track (R0…R5) that
deliberately deviated from GemTD — the press never rolled above Charged (T3), so
Primed (T4) and Tesla-Prime (T5) were reachable **only** by combining. That is now
replaced with GemTD's actual **upgrade-chances tree**, reskinned onto Arc Foundry's
quality ladder (Chipped→Scrap, Flawed→Tuned, Normal→Charged, Flawless→Primed,
Perfect→Tesla-Prime):

- **Nine rungs, R0…R8.** Each rung shifts ~10% of the odds up one quality level.
  R0 is 100% Scrap; **Primed (T4) first appears at R4 (10%)** and **Tesla-Prime (T5)
  only at the top rung R8 (10%)**. So the apex two tiers *can* now be rolled straight
  off a refined press — but only at high Refinement and only rarely.
- **Costs match GemTD's tree:** 20 / 50 / 80 / 110 / 140 / 170 / 200 / 230 Charge to
  reach R1…R8 — each step 30 more than the last, **1000 Charge** for the whole climb
  (was 60 / 130 / 240 / 400 / 620 over five rungs).
- **Combining is still the reliable climb.** Because top-tier rolls stay rare, the
  quality-combine and the recipe-combine remain the dependable way to stack the Primed
  and Tesla-Prime carries and ingredients a lucky roll won't hand you.

The "top two tiers are combine-only / the press never rolls above Charged" language
that this pillar was stated in — across `overview.md`, `towers.md`, `build.md`,
`controls.md`, `board.md`, and `flow.md` — is reconciled to the new tree. The
reference implementation (`QUALITY_ODDS_BY_R`, `MAX_REFINEMENT`, `REFINE_COST`, the
`Refinement` type, and the sim strategy model) is updated to match. The live
quality-odds bar and the UPGRADE QUALITY control already render all five tiers and a
generic `R → R+1` progression, so they surface Primed/Tesla-Prime rolls automatically.
