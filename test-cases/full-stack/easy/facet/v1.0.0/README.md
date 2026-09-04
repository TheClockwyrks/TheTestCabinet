# Facet — `v1.0.0`

This is version `v1.0.0` of the **Facet** test case. The implemented game is an
original gem-matching puzzle titled Facet, played over a lapidary's lit bench.
The board is `GRID_COLS` (`8`) by `GRID_ROWS` (`8`) cells, every cell holding
one cut stone. The player takes hold of a stone with a mouse, a pen, or a finger,
carries it onto the stone beside it and lets go; any maximal line of `MATCH_MIN`
(`3`) or more of one kind clears, the stones above fall into the gap, and fresh
ones drop in from the top, so a single move can touch off a chain that resolves
long after the player's hand has left the board. A move is only offered while the
hand is on it, so carrying a stone back where it came from takes the move back.

`facet` is the catalog slug for this case, and the game's in-fiction title. The
case belongs to the family of grid match games. What is original to it is
**strain**: every clear presses on the gems left standing around it, that
pressure never lets go, a gem at `MAX_STRAIN` (`3`) is flawed, and a flawed gem
clears with anything that clears beside it and scores double. Around that sit
three cuts — a run of `4` leaves a `brilliant`, a run of `5` or more leaves a
`prism`, and two runs crossing leave a `star` — and a round with no clock that
climbs a level at a time, totalling each level up on a screen of its own before
the next board pours in from above, and ending when the board has no legal move
left on it.

## Why this case

Facet is an `easy` full-stack case with no physics, no opponent and no clock.
Its difficulty is one of precision. Nine rules govern the game and split into
two halves that behave differently: three move rules are checked when a swap is
requested and refuse it, and six resolution rules are evaluated over the board
during a chain step and refuse nothing. A chain step resolves them in one fixed
order — seed the clear set from the runs, grow it to a fixed point through the
cuts and the flawed gems, score it, spread strain to the survivors, remove the
set, create the cuts, then settle and refill — and a build that reorders any two
of those scores a different board. Around that sit a seeded deal that owes the
player an opening board with a legal swap and no run on it, a legal-swap search
that decides when the round is over, a move offered and withdrawn under the hand
until a release commits it, a swap, a shattering set and a falling board the
chain's own cadence has to wait on, six screens every one of which is worked from
the pointer as well as the keyboard, and a debug surface that drives the real
input path.

It is also a full production pass. Every gem on the bench is a produced file
rather than a shape drawn in code, and the build makes them during the run with
the six asset tools on the image's `PATH`.

## Engines

Facet is designed for three engines, and seeds a different project for each:

| Engine          | What the seeded project supplies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`          | The toolchain configuration and `index.html`, and nothing else. There is no `src/`. The build writes the runtime, meaning the frame loop and its delta time, the canvas fit, keyboard and pointer input, audio, the overlay and the `window.__facet` surface, and then the game on top of it. The surface additionally carries the clock, as `setAutoStep` and `advance`, because nothing outside the build owns it.                                                                                                                                                                                                            |
| `simple-2d`     | The [Simple 2D](/engines/simple-2d/) package, vendored at seed time, plus `src/constants.ts` and `src/main.ts`. The build writes `src/game.ts`: `FacetState`, the debug surface, `BACKGROUND`, and the three functions. Its `initialize` returns the surface beside the state as `[state, debug]`, which the engine serves from `engine.debug`. The engine holds the state by value, so `update` is handed it as `DeepReadonly<FacetState>` and returns the next state, and the surface's operations take the state the same way. A pose returns the next state, driven through `engine.apply`; a reading returns what it read. |
| `structured-2d` | The [Structured 2D](/engines/structured-2d/) package, vendored at seed time, plus the same `src/constants.ts` and `src/main.ts`. The build writes `src/game.ts`: the `GameDefinition` with its game instance, whose `initialize` returns the debug surface, the game mode whose `gameStateClass` is the `FacetState` the world holds live, the actors and components that draw, the player controller that reads input, and `BACKGROUND`. The world is live, so the surface's poses take only their own arguments and act on it at the call, and its readings return plain data.                                                |

On both engine runs the pointer and the actions belong to the engine and reach
the build already in logical stage units with press edges. An engineless build
maps the page's pointer and keyboard itself. `specs/controls.md` branches
accordingly. The game the three projects describe is the same one, so a score
recorded under one engine is comparable with a score recorded under another.

## The single variant

Facet ships one variant, `base` (`variants/base.toml`), and nothing in the
seeded set branches on `variant.slug`. There is one board, one rule set, one
selection model, one round shape and one snapshot here. Every spec is therefore
common and seeded for every run. The `.hbs` templates branch on `engine.slug`
alone.

## Contents

| Path                   | Seeded to run? | Purpose                                                                                                                           |
| ---------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `specs/`               | Yes            | The spec handed to the model, by concern.                                                                                         |
| `workspaces/`          | Yes            | The starter TypeScript project, `<engine>/`, seeded at the run root.                                                              |
| `references/`          | No             | The authored, correct build: the shared game core, the scripts that produce the assets, and one project per engine. Never seeded. |
| `validation/`          | No             | The validator suites deciding every review point, `<engine>/<category>/`.                                                         |
| `validation-baseline/` | No             | The media those suites captured from each reference build, `<engine>/<variant>/`.                                                 |
| `showcase/`            | No             | The variant's demo media and description for the catalog.                                                                         |
| `prompt.hbs`           | No             | Rendered into the model's prompt; not seeded.                                                                                     |
| `test-case.toml`       | No             | Manifest: workspaces, engines, toolchain, specs, domains, review items.                                                           |
| `variants/`            | No             | One TOML file per variant (listed in `variants`).                                                                                 |
| `description.md`       | No             | The site-facing introduction on the case's detail page.                                                                           |
| `changelog.md`         | No             | This version's entry in the case's changelog.                                                                                     |
| `README.md`            | No             | This overview.                                                                                                                    |

`references/` is one authored build written three times, and mostly written
once: `references/core/` holds the whole game — the board, `R1`–`R9`, the chain
step, scoring, levels, controls and screens — as engine-free TypeScript beside
`references/constants.ts`, and each of `references/none/`,
`references/simple-2d/` and `references/structured-2d/` takes a verbatim copy of
it under `src/core/` and adds only the layer its engine leaves to the build.
`references/scripts/` runs the six asset tools that produce
`references/assets/`, the gems, break sheets, particle systems, cues and music
the three builds share. Each build stands on its own and is held to the case's
own `[build]` commands and the four `[toolchain]` gates a run is held to.

Every project that runs a Node builtin declares `@types/node`, so it type-checks
with nothing above it. Ten reference test modules and
`references/structured-2d/src/harness.ts` read the produced asset tree off disk
through `node:fs`, `node:path` and `node:url`, and a build's own
`src/**/*.test.ts` is free to read what it produced the same way, so each seeded
workspace declares it as well. The declared major tracks the Node the run image
carries, so a figure the type-checker accepts is one the run can call.
`references/core/` declares none: the core is engine-free and environment-free,
its `tsconfig.json` names `ES2020` and nothing else, and no module in it reaches
for a builtin.

The specification is split across `specs/` by concern, and every file is seeded
for every run:

| Spec                 | Covers                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `overview.md`        | What is built, what stays as it is, the code quality, and the commands run over the finished repository.                               |
| `board.md`           | The grid, the cell-center formula, the seven kinds, the four cuts, strain, and the notation boards are written in.                     |
| `rules.md`           | Rules `R1`–`R9`: the three move rules, the six resolution rules, the order a chain step resolves them in, the scoring, and the levels. |
| `controls.md`        | The pointer over mouse, pen and touch, each screen's pointer targets, the offer-and-release gesture, and the registered key actions.   |
| `state.md`           | What the game's state carries.                                                                                                         |
| `instrumentation.md` | The debug and automation surface and the diagnostics overlay.                                                                          |
| `ui.md`              | The `title`, `howto`, `playing`, `paused`, `levelclear` and `gameover` screens, the menus, the readouts, and the audio cues.           |
| `assets.md`          | The production contract: which tool produces which file, what is drawn in code, and how each is played.                                |
| `showcase.md`        | The store-page presentation the finished game ships beside its source.                                                                 |

`board.md`, `rules.md` and `assets.md` are plain Markdown, identical under every
engine. `overview.md.hbs`, `controls.md.hbs`, `state.md.hbs`,
`instrumentation.md.hbs`, `ui.md.hbs` and `showcase.md.hbs` are Handlebars
templates rendered on the engine axis before they land. Because the branching
resolves at seed time, each seeded set reads as one self-contained game with no
alternative in view.

Under `simple-2d` and `structured-2d`, every figure the specification fixes is
exported from the seeded `src/constants.ts` under the name the specs cite, so a
spec never restates a number the project already names. Under `none` there is no
seeded constants module, and each figure is named once in a module of the
build's own.

## Assets and media

This case declares no `assets` of pre-made art and no reference mockups, and
that is what makes it full-stack rather than end-to-end. The gems, their break
animations, the bursts and the whole sound of the bench are files the build
PRODUCES during the run, with the six asset-generation binaries the
`test-cabinet-full-stack-2d` image puts on `PATH`: `draw` for the seven kinds at
each of four strain states, the three cut treatments and the board frame;
`draw-sheet` for each kind's break animation and the prism's idle turn;
`particle-2d` for the clear burst, the flawed detonation, the cut-gem flash and
the aura that runs at every cut stone standing on the board; `sfx-synth` and
`sfx-sample` for the cue set; and `music` for the title theme and the play bed.
The HUD, the menus, the level meter, the selection mark, the on-screen `PAUSE`
and `BACK` controls and the debug overlay are drawn in code. `specs/assets.md` is the
contract: what to produce, which tool makes it, where it lands, and how it is
played.

The produced particle systems are played live rather than baked to frames, so
the case declares `packages = ["@test-cabinet/particle-runtime"]` and the seeded
`package.json` carries that library as a baked-in `file:` dependency the build
imports like any other. The produced files are committed and bundled by
`npm run build`; the tools are on `PATH` only while the run is live, so a build
that shells out to one at build time fails when it is rebuilt.

The geometry is pinned to the figure: the stage, `CELL_PITCH` (`72`), the
cell-center formulas and `GEM_HIT_R` (`36`). Where each screen's pointer targets
sit is the build's, and the case grades the four properties they must have
(`TARGET_MIN_W` by `TARGET_MIN_H` at least, wholly on the stage, no two
overlapping, and clear of the board on `playing`) against what the build reports.
The palette, the type, the gem artwork and the board's dressing are left to the
build and rated by a reviewer. What the specs fix about the look is legibility:
seven kinds told apart by hue and by silhouette, the four strain states readable
at a glance, a cut readable from a plain stone, and the readouts clear of the
board's extent.

## Validation

This case is validator-rated: every point on the checklist carries a Vitest
suite, and the validators decide the functional rating through each point's
failure cap. A reviewer rates the run's aesthetics and may override a verdict.

The checklist in `test-case.toml` holds 169 points across 20 categories, all on
the single `gameplay` domain, and each point is one observable behavior, so a
build fails exactly the rule it breaks. One of them, the showcase's existence,
carries a weight of 3; every other point is worth 1, for 171 in
total. `validation/` holds one project per
engine — `validation/none/`, `validation/simple-2d/` and
`validation/structured-2d/` — each with a suite per point at
`<category>/<id>.test.ts`. The `none` suites drive the built site in Chromium
through `window.__facet`; the two engine projects run in process against the
vendored engine and reach the surface through `engine.debug`. The three run the
same scenarios and differ only in how they reach the build, and the directory
for the run's engine is what gets staged into the built workspace.

Each project carries the same spec-derived oracle beside its harness: the board
notation and the cell-center formulas, `R1`–`R9` recomputed independently, and
the chain step resolved in the order `specs/rules.md` fixes. Every expected
value a suite asserts comes from that oracle or from a figure the specs fix,
never from a reference build. Suites pose boards through `loadBoard` in the
notation `specs/board.md` defines and drive swaps through `requestSwap` and the
pointer operations, all of which take effect the moment they are called, so a
whole scenario costs milliseconds. Every operation the surface carries writes
one element of the state, so the sequences that arrange a whole screen — a round
started, a level opened, a round quit — live in each project's `harness.ts`
rather than in the debug API.

A point declares its own media, captured by the suite that decides it: an image
where the claim is one frame, and a replay — the build's own draw commands,
recorded while the check drove it and played back against a canvas — where the
claim is a stretch of motion. Capture decides nothing; a point passes or fails
on its assertions, and the media is what a reviewer looks at afterwards.
`validation-baseline/<engine>/<variant>/` holds the same media captured from
that engine's reference build, so a reviewer sees the run's evidence and the
reference's side by side.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/full-stack/easy/facet/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version
folders.
