# Arc Foundry balance sim

A headless, deterministic balance harness that drives the exact game simulation from
`../src` — no DOM, no rendering — so a controller's play maps to reproducible results.
Use it to sanity-check the numbers in `src/constants.ts` (the single balance surface)
before touching the specs.

Arc Foundry is a faithful **GemTD reskin** (specs/build.md): each build phase you place up
to `BUILDS_PER_LEVEL` (5) rocks that each roll a random type + quality **on placement**,
you
**KEEP EXACTLY ONE** per level as a firing component (or **COMBINE** a match to climb a
rung), and every rock you do not keep hardens into an inert **BLOCKER** — the maze.
**UPGRADE
QUALITY** (Refinement R0..5) buys better roll odds. Difficulty is wave count + enemy-HP
scaling only (Easy 20 / Medium 30 / Hard 40).

## Run

From `reference-impl/base`:

```sh
npx tsx sim/run.ts                     # battery over 32 seeds × easy/medium/hard + goal checks
npx tsx sim/run.ts --detail=competent  # per-wave breakdown (leak, integ, charge, R, tier)
npx tsx sim/run.ts --detail=all
npx tsx sim/run.ts --seeds=48          # more seeds (default 24)
npx tsx sim/run.ts --map=switchyard    # substation (default) | switchyard | transformer
```

`tsx` is not a dependency; `npx` fetches it. `sim/` is excluded from the Vite build
(`tsconfig` `include: ["src"]`) — it is a dev tool, never bundled.

## How the harness models a match (deterministic, roll off the real odds)

The interactive build path (`pullPress`/`placeStamp`) rolls off the game's private press
RNG, so a single played match is one lucky/unlucky pull sequence — not a fair read on
balance. The harness instead lays each strategy's INTENDED board with the game's
deterministic dev helpers, and models the economy itself:

- the QUALITY roll is sampled **here**, per placement, from the **real** odds table
  (`QUALITY_ODDS_BY_R[R]`) with the controller's own seeded rng — so averaging a
  controller
  over many seeds reproduces the true roll distribution as a **win rate**;
- the kept/combined firing component is planted with `devPlace(type, tier)` (exact, no
  roll,
  no Charge) and the un-kept rocks with `devBlocker`; a **combine** of two standing
  duplicates
  is modeled by `mergeDuplicate` (one rises a rung, the other re-hardens into a blocker);
- the **Charge** economy is real — the game credits kill bounties, the wave-clear bonus
  and
  interest itself; the controller **debits** its own stamp + UPGRADE-QUALITY spend from
  `game.charge`, so a strategy can only lay a board it could actually afford.

A `(controller, seed)` pair therefore maps to a single reproducible result.

## The board model (why competent wins)

The three maps funnel every unit across a **central crossing leg** (row ~16). So the
planned
board (`mazes.ts`) is a **tower-lined comb** grown **center-out**: full-height vertical
teeth
march outward from the middle, the cells nearest the crossing are **firing** slots (kept
components that cover the two corridors the Load weaves through), the rest are
**blockers**
that raise the wall. The central tooth rises first — a tight early choke a 1–4 tower
opening
can hold — and the maze widens as the firing line grows. Competent grows a broad line to a
coverage floor, then spends surplus levels **merging duplicate towers into Primed /
Tesla-Prime
carries** (preferring Arc-Node / Coil, whose splash + chain clear swarms).

## The controller battery (what "balanced" means)

| Controller | Plays | Medium |
| --- | --- | --- |
| `naive` | keep a roll, no maze, no combine, no refine (route-less clump) | LOSE (~9%) |
| `no-maze` | combine + refine, but dump walls into the guns (no fold) | LOSE (~3%) |
| `no-refine` | full maze + combine, but never buy UPGRADE QUALITY | LOSE (~0%) |
| `no-combine` | full maze + refine, but never combine — caps at **Charged** | soft (~69%) |
| `competent` | full maze + refine + merge duplicates into **Tesla-Prime** carries | WIN (~81%) |

Two levers separate the field: **geometry** (`maze <px>` — the shortest open route
through the
waypoint chain; a tower-lined comb folds it well past a route-less clump) and the
**quality
ladder** (`tier` / `maxT` — **Primed and Tesla-Prime are combine-only**, so only a
combiner
reaches the carries; the roll alone caps at Charged).

## Known balance caveat — no-combine is soft (flagged, not hidden)

On these **funnel maps** a broad, well-mazed, **refined** firing line is the backbone, and
COMBINING is the decisive **edge** — competent out-wins no-combine (~81% vs ~69% on
Medium)
and is the **only** line to reach the Tesla-Prime carries — **but combining is not a hard
requirement**: a no-combine player who mazes + refines still clears Medium most of the
time.
The other three degenerates (no-maze, naive, no-refine) lose clearly and mechanically.
To make
no-combine a *hard* loss you would have to change something the balance surface cannot
reach:
maps whose waypoints do **not** already force a long perimeter route (so mazing, not the
funnel,
carries coverage), a smaller board / fewer usable tower positions (so breadth saturates
and
extra keeps are wasted), or a steeper roll cap so even a wide refined line stays
Scrap/Tuned.
The `run.ts` goal-check block prints a NOTE whenever no-combine still wins > 15% of
Medium.

## Tuning loop

Constants are `const` (no runtime override): **edit `src/constants.ts` → re-run**. The
balance
knobs are the difficulty table (`waves` / `baseMult` / `k`), the economy (`START_CHARGE`,
`STAMP_COST`, `REFINE_COST`, `INTEREST_*`, `waveClearBonus`), the roll odds
(`QUALITY_ODDS_BY_R`), and the stat curve (`QUALITY_MULT`, `RANGE_PER_TIER`, the
`COMPONENTS`
table, `LOAD`). The harness levers are `MERGE_FLOOR` (competent's coverage floor before it
starts building carries) in `strategies.ts` and the comb/clump geometry in `mazes.ts`.
**After
the numbers settle, re-sync the specs** — `build.md`, `towers.md`, `enemies.md`,
`flow.md`,
`modes.md` pin these as "fixed", so the reference implementation and the specs must
match to
the number.
