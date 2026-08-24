# Refract — `v1.0.0`

This is version `v1.0.0` of the **Refract** test case. The implemented game is an
original light-tracing puzzle titled **Refract**, played on a dark optical bench.
Each board is a lattice of optical nodes — **emitters**, **lenses**, and
**crystals** — and the player draws one beam per **channel** (`triangle`,
`square`, `diamond`) between that channel's two emitters, threading every lens of
that channel and spending the charge in every crystal it crosses. A board is
solved when every beam is complete and every crystal is exactly spent.

`refract` is the catalog slug for this case, and the game's in-fiction title. The
case belongs to the family of grid line-drawing puzzles, but the name, the look,
the optical framing, and the rule set — three channels on one board at once,
charge-carrying crystals shared between them, and the mutually exclusive
diagonals that stop beams from visibly crossing — are original to The Test
Cabinet.

## Why this case

Refract is an `easy` end-to-end case with no physics, no opponent, and no clock.
Its difficulty is precision rather than scale. Nine rules govern a beam and split
into two halves that behave differently: five **limits** are checked on every
pointer move and refuse it, and four **completion conditions** are evaluated over
a finished board and never refuse anything. A build that confuses the two halves
rejects the first segment of every board, because an empty beam does not yet
satisfy a condition phrased with "exactly". Around that sit a seeded board
generator, pointer input resolved against a hit radius, six screens across two
modes, and a debug surface that drives the real input path rather than a side
door into the state.

It is also the case where the look is most openly the build's. The geometry is
pinned to the figure — the stage, `CELL_PITCH`, the cell-center formula,
`NODE_HIT_R` — and the palette, type, node artwork, and beam rendering are not
pinned at all. What the specs do fix is legibility, because on this board
legibility is the gameplay: channels told apart by hue _and_ by silhouette,
emitters outlined where lenses are filled, crystals showing charges spent and
remaining.

## The two modes

Both modes ship in every build and are picked from the title menu, the way
Carom's Solo and Versus are modes inside a variant rather than variants of their
own. `state.mode` is `"campaign" | "cascade"` and the snapshot reports it.

| Mode         | What it is                                                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Campaign** | `CAMPAIGN_LENGTH` (`24`) hand-built boards in four sets of six, listed in `specs/campaign-boards.md` and opened in order as each is solved. It uses no randomness at all. It adds the `select` grid and the `complete` screen. |
| **Cascade**  | One unbroken sequence with no last board. The build carries a seeded generator that emits a solvable board for a given seed and tier, and the tier climbs as boards are solved. Generation runs off `state.rngState`.          |

The screens union is the union of both: `title`, `howto`, `select`, `playing`,
`solved`, `complete`. `select` and `complete` are reached in Campaign only, which
the mode specs state, but they exist in every build. The snapshot carries the
campaign fields (`boardIndex`, `solvedBoards`, `unlockedCount`) and the cascade
fields (`solvedCount`, `tier`) unconditionally; a field the current mode does not
use reports its resting value rather than going absent, so the snapshot shape is
fixed.

(The Cascade _mode_ is unrelated to the catalog's separate `cascade` test case;
the collision is in the name only.)

## Engines

The case supports two engines and seeds a different project for each, which is
what the manifest's `[workspaces]` table is for:

| Engine      | What the seeded project supplies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`      | The toolchain configuration and `index.html`, and nothing else. There is no `src/`: the build writes the runtime — the frame loop and its delta time, the canvas fit, keyboard and pointer input, audio, the overlay, and the `window.__refract` surface — and the game on top of it. The surface additionally carries the clock, as `setAutoStep` and `advance`, because nothing outside the build owns it.                                                                                                                                                                                                                            |
| `simple-2d` | The [Simple 2D](/engines/simple-2d/) package, vendored at seed time, plus `src/constants.ts` and `src/main.ts`. The build writes `src/game.ts` — `RefractState`, the debug surface, `BACKGROUND`, and the three functions — and its `initialize` returns the surface beside the state as `[state, debug]`, which the engine serves from `engine.debug`. The engine holds the state by value: `update` is handed it as `DeepReadonly<RefractState>` and returns the next state, and the surface's operations take the state the same way (a pose returns the next state, driven through `engine.apply`; a reading returns what it read). |

The pointer is the build's under **both** engines. Simple 2D owns the frame loop,
named input actions, audio cues, and the overlay, but not the pointer, so taking
it off the page and mapping it into logical units is part of the deliverable
either way. `specs/controls.md` branches accordingly.

The game both projects describe is the same one, so a score recorded under one
engine is comparable with a score recorded under the other. The specs branch only
where the deliverable genuinely differs.

## The single variant

Refract ships **one** variant, `base` (`variants/base.toml`), and nothing in the
seeded set branches on `variant.slug`. That is deliberate. Campaign and Cascade
are two ways to play one game, reached from one title menu, sharing one board
model, one rule set, one control scheme, and one snapshot shape — so making them
variants would have seeded two builds that each shipped half a game, and would
have split a checklist that has nothing to disagree about. A variant here would
have to change the _rules_, as Carom's `gyre` and `multi` do, and Refract's rules
are the case.

Every spec is therefore common and seeded for every run. The `.hbs` templates
branch on `engine.slug` alone.

## Contents

| Path             | Seeded to run? | Purpose                                                                 |
| ---------------- | -------------- | ----------------------------------------------------------------------- |
| `specs/`         | **Yes**        | The spec handed to the model, by concern.                               |
| `workspaces/`    | **Yes**        | The starter TypeScript project, `<engine>/`, seeded at the run root.    |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.                           |
| `test-case.toml` | No             | Manifest: workspaces, engines, toolchain, specs, domains, review items. |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).                       |
| `description.md` | No             | The site-facing introduction on the case's detail page.                 |
| `changelog.md`   | No             | This version's entry in the case's changelog.                           |
| `README.md`      | No             | This overview.                                                          |

The specification is split across `specs/` by concern, and every file is seeded
for every run:

| Spec                 | Covers                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| `overview.md`        | What is built, what stays as it is, the code quality, and the commands run over the finished repository. |
| `board.md`           | The grid, the cell-center formula, the node kinds, and the notation boards are written in.               |
| `beams.md`           | Rules `R1`–`R9`: the five limits, the four completion conditions, and how each half is enforced.         |
| `controls.md`        | Beginning, extending, retracting, and releasing a trace; the grab table; the keyboard actions.           |
| `state.md`           | What the game's state carries.                                                                           |
| `instrumentation.md` | The debug and automation surface and the diagnostics overlay.                                            |
| `ui.md`              | The `title`, `howto`, and `playing` screens, the menus, and the audio cues.                              |
| `campaign-boards.md` | The twenty-four campaign boards, authoritative for every layout.                                         |
| `modes/campaign.md`  | The course, its progression, and the `select` and `complete` screens.                                    |
| `modes/cascade.md`   | The endless sequence, the generator's contract, and the tier ladder.                                     |

`overview.md.hbs`, `controls.md.hbs`, `state.md.hbs`, `instrumentation.md.hbs`,
`ui.md.hbs`, `modes/campaign.md.hbs`, and `modes/cascade.md.hbs` are Handlebars
templates rendered on the engine axis before they land; `board.md`, `beams.md`,
and `campaign-boards.md` are plain Markdown, identical under either engine.
Because the branching resolves at seed time, each seeded set reads as one
self-contained game with no alternative in view.

Under `simple-2d`, every figure the specification fixes is exported from the
seeded `src/constants.ts` under the name the specs cite, so a spec never restates
a number the project already names. Under `none` there is no seeded constants
module, and the requirement is that each figure is named once in a module of the
build's own.

## Assets and media

This version has **no assets** and declares no reference mockups. The specs fix
the geometry and the rules exactly and leave the bench's appearance to the build,
drawn entirely in code, and a reviewer rates it through the domains.

## What is not built yet

This case is authored but not yet complete, and the manifest reflects only what
exists:

- **No validators.** There is no `validation/` directory. The checklist points are
  authored from the specs, but the Vitest suites that decide them — one project
  per engine, `validation/none/` and `validation/simple-2d/` — have not been
  written. Until they are, no point is machine-decided and no run's media is
  produced by a validator.
- **No reference implementation.** There is no `references/<engine>/base`, so
  `variants/base.toml` declares no `[reference_implementation]`, the case has no
  Reference tab, and there is nothing for `tcab capture-baselines` to run against.
  Consequently there is no `validation-baseline/` either.
- **Campaign board solution counts are unresolved.** All `24` boards in
  `specs/campaign-boards.md` are verified **solvable and well formed**, which is
  the load-bearing fact and the one the specs rest on. Two independent solvers
  disagreed on how many solutions some boards admit, so **no spec text claims a
  board is uniquely solvable**, and none should until the two are reconciled.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/end-to-end/easy/refract/v1.0.0/`). Each version is self-contained
and immutable once a run references it; design revisions land as new version
folders.
