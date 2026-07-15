# Arc Foundry balance sim

A headless, deterministic balance harness that drives the exact game simulation from
`../src` — no DOM, no rendering — so a controller's play maps to reproducible results.
Use it to sanity-check the numbers in `src/constants.ts` (the single balance surface)
before touching the specs.

Arc Foundry is a faithful **GemTD reskin** (specs/build.md): each build phase you place up
to `BUILDS_PER_LEVEL` (5) rocks that each roll a random type + quality **on placement**, you
**KEEP EXACTLY ONE** per level as a firing component (or **COMBINE** a match to climb a rung,
or **ASSEMBLE a COMBINATION TOWER** from a recipe), and every rock you do not keep hardens
into an inert **BLOCKER** — the maze. **UPGRADE QUALITY** (Refinement R0..5) buys better roll
odds. Difficulty is wave count + enemy-HP scaling only (**Easy 40 / Medium 50 / Hard 60**).

## What the redesign changed (and what the harness now models)

- **8 base component types.** `COMPONENT_ORDER` now carries `choke` (slow), `rectifier`
  (burn/DoT) and `regulator` (a **non-firing** support aura) alongside the original
  five. The type roll is uniform **12.5% each** (1/8). Every `Record<ComponentType, …>`
  in the harness (`CARRY_TYPE_SCORE` in `harness.ts`, `TYPE_SCORE` in `strategies.ts`)
  carries all eight — the Regulator scores **lowest** (it never fires, so you never
  keep/climb it for DPS).
- **Quality odds are steeper.** `QUALITY_ODDS_BY_R[0]` is now **100% Scrap** — every
  higher tier is earned by refining the press, and Primed/Tesla-Prime (T4/T5) are always
  combine-only. The harness samples `QUALITY_ODDS_BY_R[R]` exactly (import, never hardcode).
- **Combination towers are the headline power.** Base towers are **weak feedstock**
  now; the late game is carried by the 12 **combos**
  (`COMBOS`/`COMBO_ORDER`/`comboStats`), each a fixed far-stronger stat block with its
  own splash/chain/slow/burn/crit/multishot/aura mix. The harness stands them up with
  the deterministic `game.devPlaceCombo(combo, col, row)`.
- **6 waypoints per map** (was 3–4) → longer, loopier inherent routes. The comb/clump
  anchor geometry in `mazes.ts` is re-tuned so the planted maze still folds the route on
  all three maps.
- **Waves 40/50/60** with the updated `DIFFICULTY` table; the goal-check bands are calibrated
  for a **50-wave Medium** reference.

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
is a **tower-lined comb** grown **center-out**: full-height vertical teeth march outward
from the middle, the cells nearest the crossing row are **firing** slots (kept components
/ combos), the rest are **blockers** that raise the wall. Competent grows a base line,
refines on a schedule, climbs duplicate carries, and **assembles combination towers** on
a cadence that carry the scaled late waves.

## The controller battery (what "balanced" means)

Each degenerate differs from `competent` by **exactly one** lever, so a win-rate gap pins
that lever's worth. Numbers below are the default map (`substation`, 24 seeds); actual
figures vary until `src/constants.ts` is tuned.

| Controller | Differs by | Medium (substation, 24 seeds) |
| --- | --- | --- |
| `naive` | everything off (route-less clump of Scrap guns) | LOSE (0%) |
| `no-maze` | **geometry** — clumps its walls so the route never folds | LOSE-band (~42%) |
| `no-refine` | **UPGRADE QUALITY** — rolls stay Scrap, combos stall at the 2 all-Scrap ones | LOSE (0%) |
| `no-combo` | **combination towers** — never assembles one (reaches 0 combos) | struggles (~17%) |
| `competent` | nothing (all levers on; ~12 distinct combos late) | WIN (100%) |

Three levers separate the field: **geometry** (`maze px` — the shortest open route through
the six waypoints; the comb folds it far past a wall-less clump — see the `competent vs
naive` check), **UPGRADE QUALITY** (`R` / `tier` — a no-refine line never climbs its
feedstock), and above all the **COMBO GATE** (`combos` — base towers are weak, so a
`no-combo` line that mazes, climbs and refines still clearly underperforms the combining
competent and reaches **zero** combos while competent reaches **≥1–2 distinct** combos late).

## Goal checks

`run.ts` asserts, on the default map: competent wins Easy ≈100% / Medium ≥80% / not-trivially
Hard ≤60%; naive / no-maze / no-refine lose Medium ≤15%; the geometry lever (competent path
> 1.3× naive path); and the **combo gate** — `competent.winRate − no-combo.winRate ≥ 0.15`
and competent reaches ≥1 distinct combo while no-combo reaches 0. It prints a NOTE with the
combo-gate numbers regardless.

**Some checks are EXPECTED to FAIL until `src/constants.ts` is tuned** (the game is not
balanced yet). As of this harness rewrite, on `substation`/24 seeds the combo gate,
geometry, naive/no-refine and Hard/Medium bands PASS; `competent wins Easy` sits just
under the 95% band (~92%) and `no-maze loses Medium` FAILS (~42%) — the 6-waypoint funnel
maps hand even a clumped, combo-building line a fairly long route, so the geometry lever
is weaker than the combo lever. The combo gate is sharpest on `substation`; on the longer
`switchyard` / `transformer` routes a wide Tesla-Prime base line has enough coverage that
`no-combo` still wins Medium, so those need the most tuning. **Do not fudge the thresholds
— tune the constants.**

## Tuning loop

Constants are `const` (no runtime override): **edit `src/constants.ts` → re-run**. The
balance knobs are the difficulty table (`waves` / `baseMult` / `k`), the economy
(`START_CHARGE`, `STAMP_COST`, `REFINE_COST`, `INTEREST_*`, `waveClearBonus`), the roll
odds (`QUALITY_ODDS_BY_R`), the base stat curve (`QUALITY_MULT`, `RANGE_PER_TIER`, the
`COMPONENTS` table, `LOAD`), and — the new headline surface — the **`COMBOS`** stat blocks
and recipes. The harness levers are `MERGE_FLOOR` (competent's coverage floor before it
climbs carries), the combo pacing (`COMBO_START` / `COMBO_EVERY` / `CLIMB_SCALE` /
`COMBO_PLAN`) in `strategies.ts`, and the comb/clump geometry in `mazes.ts`. **After the
numbers settle, re-sync the specs** — `build.md`, `towers.md`, `enemies.md`, `flow.md`,
`modes.md` pin these as "fixed", so the reference implementation and the specs must match
to the number.
