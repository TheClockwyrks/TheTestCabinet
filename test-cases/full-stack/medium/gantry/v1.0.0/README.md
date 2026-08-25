# Gantry v1.0.0 — authoring notes

Gantry is the first 3D full-stack case: a crane-building puzzle whose player
rigs a tower crane on a lattice, writes an Orrery-style instruction tape for
its four axes, and runs it under a per-tick structural simulation. This file is
for people working on the case; nothing in it is seeded.

## Design intent

The case is built so that behavior is exactly decidable and appearance is
free:

- **Kinetostatic core.** The crane's motion is prescribed by the tape, so
  accelerations are closed-form and every tick reduces to two linear
  direct-stiffness solves (arm and tower, coupled through the slew ring's
  reactions). The solve has a unique answer whatever method a build uses, so
  the spec fixes the problem, not the algorithm, and validators can assert
  member forces on small canonical trusses against textbook values.
- **The one dynamic element is specified to the tick.** The hanging load is a
  constraint-projected pendulum with an exact per-tick update
  (`specs/rigging.md`), so anti-sway is real gameplay and runs replay
  identically.
- **No randomness anywhere.** Same structure + same tape → same run, tick for
  tick.
- **Speed is bought with steel.** Faster slew means centrifugal load and wider
  swing; score is cost + time. That trade-off is the case's heart.

## Infrastructure prerequisites (why `experimental = true`)

The case is authored ahead of two pieces of infrastructure and must not be
scheduled until they exist:

1. **A 3D full-stack run image** carrying `voxel`, `sfx-synth`, `sfx-sample`,
   and `music` (no 2D `draw`/`draw-sheet`/`particle-2d`). `type = "full-stack"`
   currently selects `test-cabinet-full-stack-2d`; how the type or manifest
   selects the 3D image is an open infra decision. The `voxel` binary's
   single-model config workflow also needs a decision for producing several
   models in one run (per-model working directories or config overrides).
2. **The `simple-3d` engine.** The spec `.hbs` branches and the
   `workspaces/simple-3d` seed are written against the contract it is expected
   to share with `simple-2d` (`Game<State, Debug>`,
   `initialize`/`update`/`render`, `engine.apply`, `engine.debug`, seeded
   `src/constants.ts` + `src/main.ts`). Reconcile all of that against the real
   engine when it lands — `structured-3d` support would be a later version.

   The manifest **does not declare it yet.** The engine catalogue is closed
   (`crates/core/src/engine.rs`), so an undeclarable slug does not degrade
   gracefully: it makes this whole version fail to resolve, which took the
   repo-wide catalog gates in `crates/core/tests/catalog_and_seeding.rs` down
   with it. `experimental` does not cover for that — it is read off an
   already-resolved version, so it hides a case that is otherwise valid.

   So the `simple-3d` declaration is **parked**: the `[[engine]]` table and the
   `[workspaces]` key are commented into `test-case.toml` beside the live
   `engines` list, ready to restore. Everything else is still authored and
   still committed — the starter workspace, the `{{else}}` halves of the spec
   branches (inert while only `none` renders), and the reference notes in
   `variants/base.toml`. The case ships `none`-only until the engine lands, and
   this version is not frozen, so restoring it edits in place rather than
   minting a new version.

## Still to do before the case leaves experimental

- Reference implementations (`references/none/`, `references/simple-3d/`),
  declared from `variants/base.toml`.
- A numbers pass against the reference build: the material capacities,
  masses, budgets, and par figures in `specs/structure.md` and
  `specs/sites.md` are designed to be self-consistent (a stayed 16-unit jib
  works out to roughly two-thirds of the strut capacity) but have not been
  played. Verify every site is comfortably solvable inside its budget and par,
  and tune.
- Validation suites per engine (`validation/none/`, `validation/simple-3d/`)
  and the `validation` keys on the mechanical checklist items: editor
  refusals, canonical-truss static forces, the axis controller, the pendulum
  period (`2π·sqrt(L/g)` to tolerance), attach/release verdicts, and the
  failure causes. Keep mechanism-detection scenarios far from the singularity
  threshold.
- Baselines (`tcab capture-baselines`) once references and suites exist.
