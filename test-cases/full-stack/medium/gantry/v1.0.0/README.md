# Gantry — `v1.0.0`

This is version `v1.0.0` of the **Gantry** test case, and the first 3D
full-stack case. The implemented game is a crane-building puzzle played in a
construction yard: the player rigs a tower crane out of struts, cables, and
rails on a lattice, mounts a slew ring and a trolley track, writes an
Orrery-style instruction tape for the crane's four axes, and runs it under a
per-tick structural simulation. A site is cleared when every load has been set
down on its pad; the score is the crane's cost plus the tape's running time.

`gantry` is the catalog slug and the game's in-fiction title. The name, the
yard, the material and site rosters, and the crane itself are original to The
Test Cabinet.

This is a **full-stack** case. The model does not merely build the game: it
produces the game's voxel models and its audio during the run, with the `voxel`,
`sfx-synth`, `sfx-sample`, and `music` binaries on the 3D full-stack image's
`PATH`, and then builds a game that loads what it made. `specs/assets.md` is the
production contract.

This file is for people working on the case; nothing in it is seeded.

## Why this case

Gantry is a `medium` case, and the difficulty is one of an exactly decidable
simulation carried across a large surface rather than of any single hard idea.

- **Kinetostatic core.** The crane's motion is prescribed by the tape, so
  accelerations are closed-form and every tick reduces to two linear
  direct-stiffness solves, one for the arm and one for the tower, coupled
  through the slew ring's reactions. The solve has a unique answer whatever
  method a build uses, so the spec fixes the problem and leaves the algorithm
  open, and validators can assert member forces on small canonical trusses
  against textbook values.
- **The one dynamic element is specified to the tick.** The hanging load is a
  constraint-projected pendulum with an exact per-tick update
  (`specs/rigging.md`), so anti-sway is real gameplay and runs replay
  identically.
- **No randomness anywhere.** The same structure and the same tape give the same
  run, tick for tick.
- **Speed is bought with steel.** Faster slew means centrifugal load and wider
  swing, and the score is cost plus time, so a build that gets the statics right
  and the choreography wrong is visibly broken in play.

## Engines

Gantry is designed for three engines, and seeds a different project for each:

| Engine | What the seeded project supplies |
| --- | --- |
| `none` | The toolchain configuration and `index.html`, and nothing else. There is no `src/`. The build writes the runtime, the frame loop and its delta time, the canvas fit, keyboard and pointer input, audio, asset loading, the diagnostics overlay and the `window.__gantry` surface, and then the game on top of it. It carries `@test-cabinet/voxel-runtime` as a baked-in `file:` dependency, which is what decodes a produced `.glb`. |
| `simple-3d` | The [Simple 3D](/engines/simple-3d/) package, vendored at seed time, plus `src/constants.ts` and `src/main.ts`. The build writes `src/game.ts`: the state, the debug surface, and the game's update and render. The engine holds the state by value, so a pose takes the current state and returns the next, applied through `engine.apply`, and a reading takes the state and returns what it read. |
| `structured-3d` | The [Structured 3D](/engines/structured-3d/) package, vendored at seed time, plus the same two case-owned modules. The build writes `src/game.ts`: the game definition the engine drives, its instance, its mode, its live state class, and the debug surface its instance's `initialize` returns. The world is live, so a pose acts on it at the call and a reading returns plain data. |

Neither engine supplies a linear solver, a structural model, or any of the
crane's geometry, so both solves, the slack-cable iteration, the breakage
cascade, the axis controller, and the pendulum are the build's own work under
all three. Rendering is the build's under all three as well: the two engines own
the renderer, the scene, and the camera, but the yard's geometry is the game's.

The two engine workspaces carry the engine as their only vendored package,
because both engines' asset loaders decode glTF themselves and hand a produced
`.glb` back as a node tree. Only `none` carries the voxel runtime.

The seeded specs branch on `engine.slug` alone, three ways, in
`specs/overview.md.hbs`, `specs/controls.md.hbs`, `specs/state.md.hbs`,
`specs/instrumentation.md.hbs`, `specs/assets.md.hbs`, and `prompt.hbs`. The
mechanical specs — the world, the structure, the statics, the rigging, the
program, the sites, and the UI — are engine-independent and are plain `.md`.

## The single variant

Gantry ships one variant, `base` (`variants/base.toml`): the whole game, all six
sites. The sites are content inside every build, not variants; the site select
reaches them in order. Every spec is common and seeded for every run.

## Contents

| Path | Seeded to run? | Purpose |
| --- | --- | --- |
| `specs/` | Yes | The spec handed to the model, by concern. |
| `workspaces/` | Yes | The starter TypeScript project, `<engine>/`, seeded at the run root. |
| `prompt.hbs` | No | Rendered into the model's prompt; not seeded. |
| `test-case.toml` | No | Manifest: workspace, toolchain, specs, domains, review items. |
| `variants/` | No | One TOML file per variant (listed in `variants`). |
| `description.md` | No | The site-facing introduction on the case's detail page. |
| `changelog.md` | No | This version's entry in the case's changelog. |
| `README.md` | No | This overview. |

The specification is split across `specs/` by concern, and every file is seeded
for every run:

| Spec | Covers |
| --- | --- |
| `overview.md` | What is built, the runtime layer the build is handed, the stage geometry and the tick, the code quality, and the commands run over the finished repository. |
| `world.md` | The right-handed frame, the lattice and its pitch, the build envelope, obstacles and the contact rule, the load classes, and the anatomy of a site. |
| `structure.md` | The three materials and their capacities, the ring, the trolley, counterweights and anchors, the editor's placement refusals, readiness, and the static check. |
| `statics.md` | The lumped load model, the arm and tower solves and their order, the ring check, slack cables, the singularity test, utilization and the breakage cascade, and the collision tests. |
| `rigging.md` | The hoist cable and its cap, the hook, the constraint-projected pendulum and its per-tick update, and the attach and release verdicts. |
| `program.md` | The instruction tape, its steps, the four axes and their controller, the range checks, and the seven-stage tick pipeline. |
| `controls.md` | The orbit camera, what the pointer picks and in what priority, and the registered actions and their keys. |
| `state.md` | Every field the game's state carries, and the shape a reading of it takes. |
| `instrumentation.md` | The debug and automation surface, the snapshot shape, and the diagnostics overlay. |
| `ui.md` | The screens, the menus, the readouts, and the eleven audio cues. |
| `sites.md` | The six sites: envelope, anchors, budget, par, loads, and obstacles. |
| `assets.md` | The asset-production contract: every model and sound, which binary produces it, and how the build consumes it. |

## Assets and media

This is a full-stack case, so the game ships no pre-made art: `test-case.toml`
declares no `assets` list, and the build produces every model and sound it draws
and plays. The build must be self-contained — it bundles the committed produced
files and runs with the generation binaries absent, so a build that regenerates
its assets at load time fails.

No reference mockup is seeded either. This version declares no `[[reference]]`
views, no `[[proof]]` artifacts and no `[[check]]` comparisons: nothing shows
the model a picture of the finished game, and every requirement reaches it as
prose.
What the specs fix about the look is what must be visible — a strut, a cable and
a rail told apart by form, a member's utilization read on a monotone ramp, a
load visibly hanging and swinging true to the simulation — and how it is drawn
belongs to the build.

## Where the case stands

The case is `experimental = true` and must not be scheduled. What is authored
and committed today: all twelve specs with their three-way branches, all three
starter workspaces, the prompt, the four scoring domains, and a reviewer-rated
checklist of 69 items across 9 categories. What is missing is everything that
would let a run be rated, plus one manifest change the engine format needs.

The manifest is still on the **legacy single `workspace` key**
(`workspace = "workspaces/none"`), with `engines`, the two `[[engine]]` tables,
and `[workspaces]` commented in beside it. Both 3D engines are now in the engine
catalogue (`crates/core/src/engine.rs`), so the catalogue is no longer what
blocks the declaration: what blocks it is that the engine format makes a case
**validator-rated**, and a validator-rated case requires every graded review
point to carry `validation`, `failure_cap`, and `domains`. This version is not
frozen, so restoring the format edits it in place rather than minting a new
version.

## Still to do before the case leaves experimental

- **Declare `asset_dimension = "3d"`.** A full-stack case selects its run image
  from the type and this key, and the key defaults to `2d`. Gantry does not
  declare it, so it currently resolves onto `test-cabinet-full-stack-2d`, which
  carries no `voxel` binary at all. The 3D image
  (`test-cabinet-full-stack-3d`, `containers/full-stack-3d/`) exists and
  carries the four tools `specs/assets.md` names.
- **Decide the multi-model `voxel` workflow.** The binary's config workflow
  produces one model per working directory; Gantry asks for eight. Either
  per-model working directories or config overrides, settled before the case is
  scheduled.
- **Restore the engine manifest format**: `engines = ["none"]`, the `[[engine]]`
  tables for `simple-3d` and `structured-3d`, and the `[workspaces]` table
  mapping all three, in place of `workspace`.
- **Reference implementations**, one per engine (`references/none/`,
  `references/simple-3d/`, `references/structured-3d/`), declared from
  `variants/base.toml`'s `[reference_implementation]` table.
- **Validator projects**, one per engine (`validation/none/`,
  `validation/simple-3d/`, `validation/structured-3d/`), each with a suite per
  review point at `<category>/<id>.test.ts`. Note that **both** 3D engines'
  suites run in vitest **browser** mode on headless Chromium through the
  Playwright provider, from a `validation/vitest.config.ts` the case ships and
  stages in — not in process, the way the 2D engines' suites run. Both engines
  take a `webgl2` context from the canvas the moment `createEngine` is called,
  so there is no in-process option. The `none` suites drive the built site in
  Chromium through `window.__gantry`. The seeded workspace's own
  `vitest.config.ts` stays Node-only and must, because `npx vitest run
  --coverage` is a recorded toolchain command that runs wherever the build is
  rebuilt.
- **Convert the checklist to validator-rated**: every graded point gains
  `validation`, `failure_cap`, and `domains`, and the reviewer keeps the
  aesthetic rating and the override.
- **Baselines** (`tcab capture-baselines`) into
  `validation-baseline/<engine>/base/`, once the references and the suites
  exist.
- **A showcase** (`showcase/base/` and `specs/showcase.md.hbs`), which this case
  does not yet have in any form.

The numbers pass this list used to call for is **done**. Every site in
`specs/sites.md` has a worked crane and tape that clears it inside its budget,
inside par cost and inside par time, with no member breaking and peak
utilization between `0.81` and `0.94`; the par figures are set from those
builds. Site 4's delivery pad sits at `(14, 2, 6)` and its budget at `5600`
because of that pass: with the pad at `(16, 2, 6)` the four-anchor square
cannot hold the eighteen-unit jib the reach demands, whichever crane is built.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/full-stack/medium/gantry/v1.0.0/`). Each version is self-contained
and immutable once a run references it; design revisions land as new version
folders. This version has no runs against it and is not frozen.
