# Arc Foundry balance sim

A headless, deterministic balance harness that drives the exact game simulation from
`../src` — no DOM, no rendering — so a controller's play maps to reproducible results.
Use it to sanity-check the numbers in `src/constants.ts` (the single balance surface)
before touching the specs.

Arc Foundry is a faithful **GemTD reskin** (specs/build.md): each build phase you place up
to `BUILDS_PER_LEVEL` (5) rocks that each roll a random type + quality **on placement**, you
**KEEP EXACTLY ONE** per level as a firing component (or **COMBINE** a match to climb a rung,
or **ASSEMBLE a COMBINATION TOWER** from a recipe), and every rock you do not keep hardens
into an inert **BLOCKER** — the maze. **UPGRADE QUALITY** (Refinement R0..8) buys better roll
odds. Difficulty is wave count + enemy-HP scaling only (**Easy 40 / Medium 50 / Hard 60**).

## What the redesign changed (and what the harness now models)

- **8 base component types.** `COMPONENT_ORDER` now carries `choke` (slow), `rectifier`
  (burn/DoT) and `regulator` (a **non-firing** support aura) alongside the original
  five. The type roll is uniform **12.5% each** (1/8). Every `Record<ComponentType, …>`
  in the harness (`CARRY_TYPE_SCORE` in `harness.ts`, `TYPE_SCORE` in `strategies.ts`)
  carries all eight — the Regulator scores **lowest** (it never fires, so you never
  keep/climb it for DPS).
- **Quality odds follow GemTD's upgrade-chances tree.** `QUALITY_ODDS_BY_R` is now a
  nine-rung track (R0..R8): `[0]` is **100% Scrap**, and refining the press shifts the odds
  up the ladder until, at the top rungs, it can roll **Primed (T4, from R4)** and
  **Tesla-Prime (T5, only at R8)** — sparingly, so combining stays the reliable climb. The
  harness samples `QUALITY_ODDS_BY_R[R]` exactly (import, never hardcode).
- **Combination towers are the headline power.** Base towers are **weak feedstock**
  now; the late game is carried by the 12 **combos**
  (`COMBOS`/`COMBO_ORDER`/`comboStats`), each a fixed far-stronger stat block with its
  own splash/chain/slow/burn/crit/multishot/aura mix. The harness stands them up with
  the deterministic `game.devPlaceCombo(combo, col, row)`.
- **6 waypoints per map** (was 3–4) → longer, loopier inherent routes.
- **The competent maze is now a GENERATED maximal-fold GemTD maze**, not a hand-shaped
  comb. The old comb folded the route only **~1.4–1.8×**, so the harness's `competent`
  line under-mazed a real player by **~4–6×** and its balance bands were far too soft a
  read (a hand-built forced-waypoint maze on The Substation runs the route **~1790
  tiles**, ~10.6× the wall-less route). `sim/genmaze.ts` now grows the maze greedily
  against the game's real A* (pass 1: add the wall that lengthens the ordered-chain route
  most, never sealing; pass 2: choose FIRING slots by a greedy set-cover of that route)
  and bakes it to `sim/planned-maze.ts`. The realized `competent` route is **~1237 tiles
  (~7×)** on Substation — the same order of magnitude as a real player's maze. Regenerate
  with `npx tsx sim/genmaze.ts`; `mazes.ts` reads the baked layout (and still serves the
  tight `clump` for the `no-maze` degenerate).
- **The per-wave step cap SCALES with maze length** (`runMatch` in `harness.ts`). A real
  maze is long enough that the invincible post-final Overload Dynamo takes **>240 s** to
  walk it once, so the old flat 240 s cap silently timed the finale out and misread a
  **won** run as a defeat. The cap is now `max(240, pathPx/30 + 150)` s, recomputed each
  wave. (Consequence: the headless sim is **slower** on long mazes — a 6-seed battery is
  ~4 min — because a finale / slow-crawl now runs to completion instead of being cut off.)
- **Waves 40/50/60** with the updated `DIFFICULTY` table; the goal-check bands were
  calibrated for a **50-wave Medium** reference **against the old weak comb** and now need
  re-deriving (see Goal checks).

## Run

From `reference-impl/base`:

```sh
npx tsx sim/run.ts                     # battery over 24 seeds × easy/medium/hard + goal checks
npx tsx sim/run.ts --detail=competent  # per-wave breakdown (leak, integ, charge, R, tier)
npx tsx sim/run.ts --detail=all
npx tsx sim/run.ts --seeds=48          # more seeds (default 24)
npx tsx sim/run.ts --map=switchyard    # substation (default) | switchyard | transformer
```

`tsx` is not a dependency; `npx` fetches it. `sim/` is excluded from the Vite build
(`tsconfig` `include: ["src"]`) — it is a dev tool, never bundled. There is no `sim/tsconfig`;
`tsx` transpiles per-file. (To type-check it, point `tsc` at a config that `include`s both
`src` and `sim`.)

## How the harness models a match (deterministic, roll off the real odds)

The interactive build path (`pullPress`/`placeStamp`) rolls off the game's private press
RNG, so a single played match is one lucky/unlucky pull sequence — not a fair read on
balance. The harness instead lays each strategy's INTENDED board with the game's
deterministic dev helpers, and models the economy itself:

- the QUALITY roll is sampled **here**, per placement, from the **real** odds table
  (`QUALITY_ODDS_BY_R[R]`) with the controller's own seeded rng — so averaging a controller
  over many seeds reproduces the true roll distribution as a **win rate**;
- the kept/combined firing component is planted with `devPlace(type, tier)` (exact, no
  roll, no Charge) and the un-kept rocks with `devBlocker`; a **quality-combine** of two
  standing duplicates is modeled by `mergeDuplicate` (one rises a rung, the other
  re-hardens into a blocker); a **combination tower** is stood up with `devPlaceCombo`
  (see below);
- the **Charge** economy is real — the game credits kill bounties, the wave-clear bonus and
  interest itself; the controller **debits** its own stamp + UPGRADE-QUALITY spend from
  `game.charge`, so a strategy can only lay a board it could actually afford.

A `(controller, seed)` pair therefore maps to a single reproducible result.

### The combo model (an abstraction — the one place the harness approximates)

The harness does **not** book-keep the exact ingredient multiset a real recipe demands (which
T5 arcnode etc. the player rolled/merged) — that would require replaying the whole random
press. Instead it models the mechanic's real **cost** and lets the real sim provide the
**power**:

- a strategy assembles combos on a **cadence** (first around wave `COMBO_START`, then ~every
  `COMBO_EVERY` waves) from an escalating `COMBO_PLAN` ordered by the recipe's highest
  ingredient tier (all-Scrap early → Tesla-gated apex late);
- a combo is only reachable once the strategy can **produce** its top ingredient tier —
  `reachableIngredientTier(canClimb, refinement, wave)` = what the press can ROLL (refinement)
  plus, if it climbs the ladder (`combine`), rungs earned over time, faster with more
  refinement. So a **no-refine** line (rolls only Scrap) barely climbs and stalls at the two
  all-Scrap early combos, and the Tesla-gated apex combos only come within reach of a refined
  climber deep into the run — which is what makes the apex combos gate the late game;
- `assembleCombo` then spends `(recipe.length − 1)` of the firing line's **weakest**
  base towers as ingredients (each hardens into a **blocker** in place — wall-neutral,
  exactly like the real `resolveCombo`) and stands the combo up with `devPlaceCombo`,
  whose live stats (splash/burn/crit/multishot/aura) are **exact** once placed.

So the abstraction is only in *which* specific ingredients were spent and *when* the high-tier
ones were affordably reachable; the combo's firing behavior is the real sim's. The
**real-sim runs are the source of truth** for status effects and DPS.

## The board model (why competent wins)

The three maps funnel every unit through six waypoints. The planned board (`mazes.ts`)
is the **generated maximal-fold maze** of `sim/planned-maze.ts` (see the maze bullet above):
its FIRING slots (kept components / combos) line the hot corridors the route re-crosses, and
its BLOCKER walls force those switchbacks. Competent grows a base line, refines on a schedule,
climbs duplicate carries, and **assembles combination towers** on a cadence.

## The controller battery (what "balanced" means)

Each degenerate differs from `competent` by **exactly one** lever, so a win-rate gap pins
that lever's worth: `naive` (everything off — a route-less clump of Scrap guns), `no-maze`
(geometry off — clumps its walls so the route never folds), `no-refine` (UPGRADE QUALITY
off), `no-combo` (never assembles a combination tower), `competent` (all levers on).

A **first-pass retune** (substation, 12 seeds) now has the levers separating again:

| line | Easy | Medium | Hard |
| --- | --- | --- | --- |
| `naive` | LOSE | LOSE | LOSE |
| `no-refine` | win | **LOSE** | LOSE |
| `no-maze` | win | 75% | **LOSE** |
| `no-combo` | win | win | **LOSE** |
| `competent` | **100%** | **100%** | **~58%** |

`competent` is the **only** line that clears Hard (the combo, geometry, and refine gates all
bite there), and Hard sits in the target ~50–75% band. Three changes got here, all done and
re-synced to the specs:

- **Placement fixed** (see the placement bug section): a recipe combine lands the combo at
  its most CENTRAL ingredient's footprint (mirroring `combineRecipeNow`), kept towers
  RE-STAMP the best open firing slot (the stamp-onto-a-blocker rule, `specs/build.md`)
  instead of marching outward, and blockers backfill every unclaimed planned slot so a thin
  firing line still raises the full maze.
- **Combos buffed proportionally** (`COMBOS` in `constants.ts`, re-synced to `towers.md`):
  each combo's damage was set from its recipe's ingredient DPS so a combo is a moderate step
  up from what it consumes — early all-Scrap combos stay modest, the Tesla-gated apexes
  (rupturenode, auroralance) become clearly-better-than-their-T5-ingredient monsters. A combo
  still lands at ×0.5 (level 0), so assembling one is a step up, not a cliff.
- **Difficulty re-weighted to the LATE game** (`DIFFICULTY`, re-synced to `modes.md` /
  `enemies.md`): Medium/Hard keep the original `baseMult`/`k` (early–mid unchanged, still
  survivable) and raise only the exponential surcharge (`c`, `r`) — the back-third wall —
  so Hard is "easy early, brutal late" rather than punishing throughout.

Two caveats to playtest, both minor: `no-combo` (a maxed base line) still wins **Medium**
(the combo gate only bites on Hard — arguably fine for the reference difficulty), and
`competent` has occasional early-death variance (a seed or two where the first few rolls give
no firing tower — controller luck, not the curve), which pulls its mean-cleared down.

## Goal checks

`run.ts` reports (informationally) competent's Easy/Medium/Hard win rates, the geometry
ratio (competent path vs wall-less naive), and the combo-gate numbers. After the first-pass
retune these read roughly: competent Easy/Medium ~100%, Hard ~50–75%; degenerate lines lose
Hard; competent maze ~7× the wall-less route. Numbers are seed-noisy at low counts — use
`--seeds=24`+ for a stable read. **If you re-tune, adjust the constants (then re-sync the
specs) — never fudge the thresholds.**

## Tuning loop

Constants are `const` (no runtime override): **edit `src/constants.ts` → re-run**. The
balance knobs are the difficulty table (`waves` / `baseMult` / `k`), the economy
(`START_CHARGE`, `REFINE_COST`, `waveClearBonus` — placing rocks is free), the roll
odds (`QUALITY_ODDS_BY_R`), the base stat curve (`QUALITY_MULT`, `RANGE_PER_TIER`, the
`COMPONENTS` table, `LOAD`), and — the new headline surface — the **`COMBOS`** stat blocks
and recipes. The harness levers are `MERGE_FLOOR` (competent's coverage floor before it
climbs carries), the combo pacing (`COMBO_START` / `COMBO_EVERY` / `CLIMB_SCALE` /
`COMBO_PLAN`) in `strategies.ts`, and the maze geometry — regenerate it with
`npx tsx sim/genmaze.ts` (writes `sim/planned-maze.ts`; `mazes.ts` reads it and still
holds the `clump` for `no-maze`). **After the
numbers settle, re-sync the specs** — `build.md`, `towers.md`, `enemies.md`, `flow.md`,
`modes.md` pin these as "fixed", so the reference implementation and the specs must match
to the number.
