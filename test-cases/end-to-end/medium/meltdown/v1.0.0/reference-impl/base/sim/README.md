# Meltdown — headless balance harness

A small, deterministic simulation harness that drives the **exact** game logic in
`../src` with no DOM, no `requestAnimationFrame`, and no rendering, as fast as the
CPU allows. It exists to balance the game from evidence instead of guesswork: a
scripted "player" (a `Controller`) lays out towers each build phase, the harness
sends every wave and steps the fixed simulation to completion, and it reports how
far the run got and how engaged the heat system was.

Because the simulation has no randomness and fixed spawn schedules, a layout maps
to a single reproducible result — so a change to a constant or a maze is directly
measurable.

## Running

```
npx tsx sim/run.ts               # the balance report + the four goal checks
npx tsx sim/run.ts --detail=ace-managed   # per-wave breakdown for one controller
npx tsx sim/run.ts --funded      # unlimited money — isolates mechanics from economy
npx tsx sim/probe.ts             # maze path lengths + steady-state heat per emitter
```

## The design goals it checks

The `=== goal check ===` block at the end of `run.ts` asserts the two balance
goals the game is tuned for:

1. **You must maze at least a bit.** A no-maze defence (`flank-no-maze`) and a
   maxed no-maze battery (`flank-battery`) both lose.
2. **You must use the heat mechanic.** `ace-ignored` and `ace-managed` build the
   *same* maze and economy; the only difference is heat play — `ace-managed`
   rotates radiator faces into the open lanes and threads Sinks so its fed guns
   hold their plateau, while `ace-ignored` leaves them solid so they bake and
   trip. Managed **wins**; ignored **loses**. That controlled A/B is the proof
   that heat management is required, not optional.

## Files

- `harness.ts` — `newGame()`, `runMatch(controller)`, the per-wave metrics
  (leaks, trips, plateau/peak heat, hot-gun fraction), and `layoutController()`
  for declarative layouts.
- `ace.ts` — the competent reference player (grow a fed comb maze, run it hot,
  answer each wave's mix with specialists), with a `managed`/`ignored` twin.
- `mazes.ts` — a library of maze builders (flank, combs, boustrophedon) used as
  strategy goalposts and by the probe.
- `strategies.ts` — the controller set the report runs.
- `run.ts` — the report + goal checks.
- `probe.ts` — geometry/heat diagnostics for designing mazes from numbers.

## How it drives the game

The harness only uses the game's public, input-free control surface (added to
`Game` for exactly this purpose): `beginMatch()`, `build(type, col, row, rot)`
(the `rot` argument fixes the placement rotation — a placed tower cannot be
rotated afterward), `upgrade(t)`, `sell(t)`, `launchWave(early)`, and
`fixedStep(dt)`.
These call the same code paths the mouse/keyboard handlers do, so a simulated
match is identical to a played one.
