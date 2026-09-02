# Gantry — `v1.0.0`

This is version `v1.0.0` of the **Gantry** test case, and the first 3D
full-stack case. The implemented game is a crane-building puzzle played in a
construction yard: the player rigs a tower crane out of struts, cables, and
rails on a lattice, mounts a slew ring and a trolley track, writes an
Orrery-style instruction tape for the crane's four axes, and runs it under a
per-tick structural simulation. A site is cleared when every load has been set
down on its pad; the score is the crane's cost and the tape's running time,
ranked by cost with time breaking ties.

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
  swing, and a score is a cost and a time — cost first, time the tie-break — so
  a build that gets the statics right and the choreography wrong is visibly
  broken in play.

## Engines

Gantry is designed for three engines, and seeds a different project for each:

| Engine | What the seeded project supplies |
| --- | --- |
| `none` | The toolchain configuration and `index.html`, and nothing else. There is no `src/`. The build writes the runtime, the frame loop and its delta time, the canvas fit, keyboard and pointer input, audio, asset loading, the diagnostics overlay and the `window.__gantry` surface, and then the game on top of it. It carries `@test-cabinet/voxel-runtime` as a baked-in `file:` dependency, which is what decodes a produced `.glb`. |
| `simple-3d` | The [Simple 3D](/engines/simple-3d/) package, vendored at seed time, plus `src/constants.ts`, `src/main.ts`, and a stub `src/game.ts`. The build implements `src/game.ts`: the state, the debug surface, and the game's update and render. The engine holds the state by value, so a pose takes the current state and returns the next, applied through `engine.apply`, and a reading takes the state and returns what it read. |
| `structured-3d` | The [Structured 3D](/engines/structured-3d/) package, vendored at seed time, plus the same three case-owned modules. The build implements `src/game.ts`: the game definition the engine drives, its instance, its mode, its live state class, and the debug surface its instance's `initialize` returns. The world is live, so a pose acts on it at the call and a reading returns plain data. |

Both stubs are written against `GantryState` and `GantryDebugApi`, so a freshly
seeded engine workspace does not type-check until the build declares those two
types.

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
prose. What the specs fix about the look is what must be visible — a strut, a
cable and a rail told apart by form, a member's utilization read on a monotone
ramp, a load visibly hanging and swinging true to the simulation — and how it
is drawn belongs to the build.

## Where the case stands

The case is `experimental = true` and must not be scheduled. What is authored
and committed today: all twelve specs, the five that branch three ways
included, all three starter workspaces, the prompt, `asset_dimension = "3d"` so
a run schedules onto the 3D full-stack image, the four scoring domains, and a
reviewer-rated checklist of 70 items across 9 categories. What is missing is
everything that would let a run be rated.

The manifest is still on the **legacy single `workspace` key**
(`workspace = "workspaces/none"`), with `engines`, the two `[[engine]]` tables,
and `[workspaces]` commented in beside it. Both 3D engines are in the engine
catalogue (`crates/core/src/engine.rs`), so the catalogue is not what blocks the
declaration: what blocks it is that the engine format makes a case
**validator-rated**, and a validator-rated case requires every graded review
point to carry `validation`, `failure_cap`, and `domains`. This version is not
frozen, so restoring the format edits it in place rather than minting a new
version.

## Still to do before the case leaves experimental

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
`specs/sites.md` has a worked crane and a tape that clears it inside its budget,
inside par cost and inside par time, with no member breaking:

| Site | Cost | Budget | Par cost | Clear | Par time | Peak utilization |
| --- | --- | --- | --- | --- | --- | --- |
| 1 First Lift | `2238.9` | `3000` | `2400` | `16.63 s` | `18` | `0.870` |
| 2 Turnabout | `2278.9` | `3600` | `2400` | `52.35 s` | `55` | `0.868` |
| 3 Over the Wall | `3369.6` | `4000` | `3550` | `37.92 s` | `40` | `0.908` |
| 4 Long Reach | `4992.4` | `5600` | `5250` | `44.10 s` | `47` | `0.909` |
| 5 High Shelf | `3982.6` | `4800` | `4200` | `95.87 s` | `101` | `0.814` |
| 6 Heavy Haul | `4507.8` | `6000` | `4750` | `101.57 s` | `107` | `0.932` |

Peak utilization runs from `0.814` at Site 5 to `0.932` at Site 6, so every
worked crane is loaded hard and none of them is near breaking.

The figures were measured with a dependency-free node simulation of the specs —
the two solves, the slack-cable iteration, the breakage cascade, the pendulum,
the axis controller, the tape — written against `specs/` alongside these
passes. That simulation is not in this tree, so no figure here can be re-run
from the version directory as it stands, and the reference implementations
listed above are what will change that — they need the same core. With the
simulation in hand, most of this section comes back and one part of it does not:

| Figures | What produces them |
| --- | --- |
| The summary table above — each site's cost, clear time, and peak utilization | The simulation, run per site over the worked crane and tape it holds for that site |
| The room figures for Sites 3 and 4 — the eleven variants' costs, how many of them clear, and the margins over them | The simulation, driven over a fixed list of ordinary perturbations of each worked crane |
| Site 3's leanest clearing build, `3329.6` at `0.977` | The simulation, driven over the tower and arm variants at the height the wall forces |
| The two-crane probe at `(16, 2, 6)` | The simulation, with Site 4's target moved back to it |
| The wider search for a crane that clears `(16, 2, 6)` | One run that left no artifact; it is recorded below as a claim rather than a figure |

Par is set from that summary table by one rule, both halves alike: **par cost
is 1.05x the worked crane's cost rounded up to the next `50`, and par time is
1.05x its clear time rounded up to the next whole second.** Four of the six par
costs already followed it. Site 3's (`3500` to `3550`) and Site 4's (`5150` to
`5250`) were brought onto it, and every par time was reset from about 1.5x the
clear time, a scale that left the time half of a score nearly free to beat
while the cost half sat a few percent above the leanest crane found.

Site 4's delivery pad moved from `(16, 2, 6)` to `(14, 2, 6)`, and it is worth
being exact about why, because only part of what was measured then survives.
What the simulation still reproduces is a two-crane probe with the target put
back at `(16, 2, 6)`: the worked crane's sixteen-unit jib cannot reach that pad
at all, because the trolley has no station for the point and there is therefore
no tape to run, and the eighteen-unit jib that does reach it costs `5268.6` and
collapses at `t = 0.02 s` with one member broken, at any budget. A wider search
over cranes at that reach was run against the site's budget of the time,
`5200`, and turned up nothing that held the load, but it left no artifact, so
it is recorded here as a claim rather than as a figure. No crane clearing
`(16, 2, 6)` was found; none was shown not to exist. At `(14, 2, 6)` the worked
crane clears with `0.909` peak utilization.

Site 4's budget then moved from `5200` to `5600`, for the same reason Site 3's
moved below: room, not need. At `5200` the site left `207.6` over the worked
crane, and it was the only one of the six whose budget refused an ordinary
variation of its own crane. The measurement was eleven variants of each site's
worked crane — the crane itself and ten ordinary perturbations of it: denser
jib bays, a four-wide jib, no cross-brace at the tip, an extra counterweight,
one fewer, plan bracing, body bracing, stays carried further in, a longer
counter-jib, two more units of jib. Site 4 rejected three of them on cost alone
(`5431.2`, `5297.9`, `5268.6`); no other site rejected any. At `5600` it
rejects none, seven of the eleven clear, and the budget stands `607.6` over the
cheapest of them and `302.1` over the dearest. Par cost follows the rule above
to `5250`. The pad and the budget are the only figures that moved on this site.

Site 3's budget moved from `3600` to `4000` for the same reason: nothing about
the site changed, only the room it leaves. The wall is eight units tall, so a
crate carried over it needs its underside at `y 8`, its hook at `y 10`, and —
with `HOIST_MIN` `1` — a trolley at `y 11` or higher, which puts the ring at
`y 10` and fixes the tower at three braced levels. That floor is real: among
the tower and arm variants searched at that height the leanest build that
clears costs `3329.6` and peaks at utilization `0.977`, and the worked crane
costs `3369.6`, so a `3600` budget left a player `230.4` to be wrong with.
Going around the wall rather than over it is not the escape it looks like — the
wall stops two units short of the envelope at each end, but every tape that
tried that gap struck the wall on the swing. The budget is now `4000`, `630.4`
over the worked crane and `99.9` over the dearest of those eleven variants
that still clears, which puts the two sites in one band. Par cost is `3550`.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/full-stack/medium/gantry/v1.0.0/`). Each version is self-contained
and immutable once a run references it; design revisions land as new version
folders. This version has no runs against it and is not frozen.
