# Locomotivation balance sim

A headless, deterministic balance harness that drives the **exact** core simulation from
`../src/sim` — no DOM, no rendering, no wall clock — so a scripted route's play maps to a
reproducible result. Use it to tune the campaign data in `../src/levels.ts` (the balance
surface) before touching the specs. The harness **never** edits the level data; tuning is
a data edit the balance pass makes (`../../specs/levels.md`).

```sh
npx tsx sim/run.ts            # the report + goal checks (exits non-zero on any failure)
npx tsx sim/run.ts --detail   # + full per-level tables for the degenerate baselines
```

## What it drives

Each level is played by a **scripted route** (`routes.ts`) — the ordered fetch → haul →
deliver plan of a competent courier. A `RouteController` (`strategies.ts`) executes a
route against the pure core: it drives the worker along each move's single-axis waypoints
and, before committing a move that enters a lethal train **band**, it **gates** on the
deterministic schedule. The gate predicts the worker's own trajectory at the real
**sprint-then-walk** speed the sim will produce (once the sprint bar empties mid-move the
driver latches sprint off, so the prediction is exact) and refuses to start until no train
overlaps that trajectory across a small safety window. So the route encodes *where* a
skilled player goes; the controller supplies *when* it is safe to move — reading the
schedules exactly as `specs/trains.md` intends.

Three controllers run:

- **competent** — the schedule-reading route above, carrying **light** (batching parcels
  but hauling heavy crates/loads one at a time to keep sprint available). This is the
  "competent play" the beatability invariant is measured against.
- **reckless** — the same routes with **gating off**: it charges every crossing without
  reading the schedule, so the trains catch it (the *timing* pressure).
- **greedy** — gates, but **overloads** each depot toward the weight cap, so on the
  crate/load levels it locks sprint and crawls, dragging its crossings out until the tight
  clocks beat it (the *carry-weight* pressure).

## What it reports & checks

Per level: completed?, the beatability **margin** (shift clock still on the board the
moment the quota was met), time used, deaths / lives used, unique deliveries, quota met,
and score. Then it asserts the balance goals (`specs/levels.md`) and exits non-zero on any
failure:

- **Determinism** — the same input tape yields a byte-identical fingerprint (and a live
  world advances), and the junction **lever** deterministically diverts subsequent trains
  to a siding.
- **Beatable** — the competent route clears **every** level within its clock and 3 lives,
  with a sensible margin and no unique lost.
- **Ramp** — L1 is comfortable (a large margin); the middle levels are tighter; L5/L6 are
  the hard shifts (a small margin). Some levels are clearly harder than others.
- **Pressure** — `reckless` and `greedy` both do clearly worse (fewer clears, far lower
  score, smaller margins): the timing and the carry weight actually bite.

## Files

- `harness.ts` — `runLevel(level, controller)` steps a level to a terminal phase under a
  `Controller`, capturing the outcome, the quota-completion margin, lives, and uniques;
  `fingerprint(level, tape)` for the determinism check.
- `routes.ts` — the six scripted campaign routes (the balance surface's "competent play").
- `strategies.ts` — the `RouteController` + its schedule-reading gate, and the `reckless`
  / `greedy` factories.
- `run.ts` — the report and the goal-check battery.
