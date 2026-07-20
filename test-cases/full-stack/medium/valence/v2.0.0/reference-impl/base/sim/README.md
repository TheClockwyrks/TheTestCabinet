# Valence balance sim

A headless, deterministic balance harness that drives the exact game simulation from
`../src` — no DOM, no rendering — so a tower layout maps to a single reproducible result.
Use it to sanity-check the numbers in `src/constants.ts` before touching the specs.

## Run

From `reference-impl/base`:

```sh
npx tsx sim/run.ts                 # report + the goal checks (PASS/FAIL)
npx tsx sim/run.ts --detail=<name> # per-round breakdown (leaks, integrity, $, towers, kills)
npx tsx sim/run.ts --detail=all
npx tsx sim/run.ts --funded        # unlimited energy — isolates MECHANICS from ECONOMY
```

Controller names: `energy-spam`, `no-detection`, `no-upgrade`, `one-lane`, `competent`,
`lean-A`, `lean-B`. `tsx` is not a dependency; `npx` fetches it. `sim/` is excluded from
the Vite build (`tsconfig` `include: ["src"]`) — it is a dev tool, never bundled.

## The goal checks (what "balanced" means)

The redesign's contract (specs/matter.md, specs/towers.md): no single tower is a lock, no
capability is monopolized, upgrades and coverage both matter. The checks encode that:

1. **energy-only spam must lose** — energy can't touch a heavy (needs kinetic/nuclear).
2. **no-detection must lose** — inert matter leaks with nothing to reveal it.
3. **never-upgraded must lose** — tier-I firepower drowns under late hit points.
4. **one-lane cluster must lose** — on the branching map, coverage must reach both lanes.
5. **competent mixed + upgraded + placed must win** (realistic economy).
6. *(soft)* **both branch leanings win** — neither branch family dominates.

Run `--funded` to confirm 1–4 lose for **mechanical**, not economic, reasons: even with
unlimited money the energy-only, no-detection, never-upgraded, and one-lane boards still
lose, while the competent board wins outright.

## Structure

- `paycheck.ts` — asserts the damage-proportional economy case by case (`npx tsx
  sim/paycheck.ts`): what a shot pays on a plain unit, and what a bond pool pays as it
  drains and when it breaks. Run it after touching `damageUnit` / `bondDamage`.
- `harness.ts` — `newGame()`, `runMatch(controller, {funded})`, `layoutController()`
  (declarative `BuildOrder[]`), and board `ANCHORS`/`cellNear` placement helpers.
- `strategies.ts` — the controller battery `run.ts` uses.
- `run.ts` — the report + goal-check runner.

Controllers drive `Game` only through its input-free control API
(`start/place/upgrade/sell/startRound/fixedStep`, `upgradeCost`), so a simulated match is
identical to a played one.

## Tuning loop

Constants are `const` (no runtime override): **edit `src/constants.ts` → re-run**. The
balance knobs are the tower stat table and `deriveStats()` (per-branch effects), the
`MATTER` table and the `scaled*` functions, and the economy constants
(`INTEREST_*`, `roundClearBonus`, `UPGRADE_MULT`, `MODE.startEnergy/startIntegrity`). To
sweep a value, `sed -i` the constant then re-run. **After the numbers settle, re-sync the
specs** — `specs/matter.md`, `specs/towers.md`, and `specs/flow.md` pin these as "fixed",
so the reference implementation and the specs must match to the number.
