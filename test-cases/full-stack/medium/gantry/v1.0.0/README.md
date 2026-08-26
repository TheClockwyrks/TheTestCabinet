# Gantry — `v1.0.0`

Gantry is the first 3D full-stack case: a crane-building puzzle whose player
rigs a tower crane on a lattice, writes an Orrery-style instruction tape for
its four axes, and runs it under a per-tick structural simulation. This file
is for people working on the case; nothing in it is seeded.

## Design intent

The case is built so that behavior is exactly decidable and appearance is
free:

- Kinetostatic core. The crane's motion is prescribed by the tape, so
  accelerations are closed-form and every tick reduces to two linear
  direct-stiffness solves, one for the arm and one for the tower, coupled
  through the slew ring's reactions. The solve has a unique answer whatever
  method a build uses, so the spec fixes the problem and leaves the algorithm
  open, and validators can assert member forces on small canonical trusses
  against textbook values.
- The one dynamic element is specified to the tick. The hanging load is a
  constraint-projected pendulum with an exact per-tick update
  (`specs/rigging.md`), so anti-sway is real gameplay and runs replay
  identically.
- No randomness anywhere. The same structure and the same tape give the same
  run, tick for tick.
- Speed is bought with steel. Faster slew means centrifugal load and wider
  swing, and the score is cost plus time.

## Infrastructure prerequisites

The case is authored ahead of two pieces of infrastructure and must not be
scheduled until they exist. `experimental = true` keeps it out of the catalog
meanwhile.

1. A 3D full-stack run image carrying `voxel`, `sfx-synth`, `sfx-sample`, and
   `music`, and none of the 2D `draw`, `draw-sheet`, or `particle-2d` tools.
   `type = "full-stack"` currently selects `test-cabinet-full-stack-2d`; how
   the type or manifest selects the 3D image is an open infra decision. The
   `voxel` binary's single-model config workflow also needs a decision for
   producing several models in one run, either per-model working directories
   or config overrides.
2. The `simple-3d` engine. The spec `.hbs` branches and the
   `workspaces/simple-3d` seed are written against the contract it is expected
   to share with `simple-2d` (`Game<State, Debug>`,
   `initialize`/`update`/`render`, `engine.apply`, `engine.debug`, seeded
   `src/constants.ts` + `src/main.ts`). Reconcile all of that against the real
   engine when it lands; `structured-3d` support would be a later version.

The whole engine manifest format is parked until both land. The engine
catalogue is closed (`crates/core/src/engine.rs`), so declaring a slug it does
not carry makes this version fail to resolve and takes the repo-wide catalog
gates in `crates/core/tests/catalog_and_seeding.rs` down with it.
`experimental` cannot cover for that: the flag is read off an already-resolved
version. The format also makes a case validator-rated, which requires every
graded review point to carry `validation`, `failure_cap`, and `domains`.

So the `engines` list, the `[[engine]]` table, and the `[workspaces]` key are
commented into `test-case.toml` beside the legacy single `workspace` key that
stands in for them, ready to restore, and the checklist stays reviewer-rated.
Everything else is still authored and still committed: the starter workspace,
the `{{else}}` halves of the spec branches, inert while only `none` renders,
and the reference notes in `variants/base.toml`. The case ships `none`-only
until the engine lands, and this version is not frozen, so restoring the
format edits it in place rather than minting a new version.

## Still to do before the case leaves experimental

- Reference implementations (`references/none/`, `references/simple-3d/`),
  declared from `variants/base.toml`.
- A numbers pass against the reference build. The material capacities, masses,
  budgets, and par figures in `specs/structure.md` and `specs/sites.md` are
  designed to be self-consistent, a stayed 16-unit jib working out to roughly
  two-thirds of the strut capacity, but have not been played. Verify every
  site is comfortably solvable inside its budget and par, and tune.
- Validation suites per engine (`validation/none/`, `validation/simple-3d/`)
  and the `validation` keys on the mechanical checklist items: editor
  refusals, canonical-truss static forces, the axis controller, the pendulum
  period (`2π·sqrt(L/g)` to tolerance), attach/release verdicts, and the
  failure causes. Keep mechanism-detection scenarios far from the singularity
  threshold.
- Baselines (`tcab capture-baselines`) once references and suites exist.
