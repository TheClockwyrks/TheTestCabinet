# Arc Foundry balance sim

A headless, deterministic balance harness that drives the exact game simulation from
`../src` — no DOM, no rendering — so a controller's play maps to reproducible results.
Use it to sanity-check the numbers in `src/constants.ts` (the single balance surface)
before touching the specs.

Arc Foundry is a **GemTD reskin**: the scrap-press roll is **random** (type + quality),
you build a **maze** out of towers through the map's **ordered waypoints**, and you climb
a five-rung **quality ladder** by **combining** matches. Because the roll is random, a
single seed is not representative — the harness reseeds the press **per match** and
`run.ts` averages each controller over **many seeds** into a **win rate**.

## Run

From `reference-impl/base`:

```sh
npx tsx sim/run.ts                    # battery over 16 seeds × easy/medium/hard + goal checks
npx tsx sim/run.ts --funded           # mechanics only: unlimited Charge + exact tiers
npx tsx sim/run.ts --detail=competent # per-wave breakdown: leak, integ, comps, tier, maze
npx tsx sim/run.ts --detail=all
npx tsx sim/run.ts --seeds=32         # more seeds (default 16 realistic / 4 funded)
npx tsx sim/run.ts --map=switchyard   # substation (default) | switchyard | transformer
```

`tsx` is not a dependency; `npx` fetches it. `sim/` is excluded from the Vite build
(`tsconfig` `include: ["src"]`) — it is a dev tool, never bundled.

## The controller battery (what "balanced" means)

Each controller drives the game through the **input-free control API only** (the harness
`pullAndPlace` / `devPlaceNear` / `combineUp` helpers), so a simulated match is identical
to a played one. Together they pin the GemTD contract (specs/build.md, specs/board.md,
specs/towers.md):

| Controller | Plays | Should |
| --- | --- | --- |
| `naive` | keep every random stamp where it lands, never combine, no maze | LOSE |
| `no-combine` | build the planned maze well, but never climb the ladder | LOSE |
| `no-maze` | climb the ladder, but clump the guns (route never folds) | LOSE / struggle |
| `competent` | planned maze + combine surplus into carries + targeting + recycle | WIN (medium) |
| `lean-arcnode` / `lean-discharge` | competent maze, but climb only ONE type | (soft) ≤ competent |

Two levers are under test: **geometry** (the `maze <px>` column — the shortest open route
length through the waypoint chain) and the **quality ladder** (the `tier` column — mean
firing-line quality; a good board is bimodal: many T1 wall-chaff + a few T4/T5 carries).
`no-combine` isolates the ladder (long maze, T1 only); `no-maze` isolates geometry (short
route, high tier).

## Realistic vs `--funded`

- **Realistic** plays the actual random scrap-press over seeds under the real economy —
  it answers *"is the reference difficulty tuned right?"*
- **`--funded`** swaps the random press for exact `devPlace` tiers with unlimited Charge —
  a **best-case mechanics probe**. If a degenerate board loses even here, the loss is
  **mechanical** (geometry / ladder), not economic. If it *wins* here, that mechanic is
  under-weighted.

Reading the two together separates a **mechanics** problem from an **economy** problem.

## How competent plays

Each build phase it spends the 5-stamp allowance pulling the press and placing toward the
map's planned maze (`mazes.ts` — full-height alternating teeth that force the Load to
weave), advancing along the anchor list so the serpentine fills in order. It then combines
every matching pair **above a wall-count floor** (`mazeFloor`) — so the route stays long
while the surplus climbs to T4/T5 carries — points Discharge Rigs at the strongest unit
(anti-boss), and, mid-game, recycles unclimbable T1 chaff into slag walls for extra rolls.
The result is a bimodal board: a ~40-tower maze skeleton plus a handful of high-tier
carries.

## Tuning loop

Constants are `const` (no runtime override): **edit `src/constants.ts` → re-run**. The
balance knobs are the component stat table + `deriveStats()` / `QUALITY_MULT`, the roster
(`LOAD`) and its `scaledHp` (`baseMult`, `k` per difficulty), the economy
(`START_CHARGE/INTEGRITY`, `BUILDS_PER_LEVEL`, `STAMP_COST`, `INTEREST_*`,
`waveClearBonus`, `EARLY_SEND_PER_SECOND`), and the `STAMP_QUALITY_WEIGHT` roll odds. To
sweep a value, `sed -i` the constant then re-run. **After the numbers settle, re-sync the
specs** — `specs/build.md`, `specs/towers.md`, `specs/enemies.md`, and `specs/flow.md` pin
these as "fixed", so the reference implementation and the specs must match to the number.
