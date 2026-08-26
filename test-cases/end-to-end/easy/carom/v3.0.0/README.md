# Carom — `v3.0.0`

This is version `v3.0.0` of the **Carom** test case. The implemented game is an
original paddle-and-ball duel: classic paddle mechanics plus a spin mechanic,
where a paddle's motion curves the ball, and two obstacles in the field. Each
variant plays the same two ways, Solo and Versus, and changes the rules of the
game itself, which apply equally to both.

The name, look, spin mechanic, and obstacle layout are original to The Test
Cabinet. `carom` is the catalog slug for this lineage of paddle-and-ball cases,
and the game's in-fiction title. The manifest pins the case's identity to its
original `pong` slug, which the runs published before the folder was renamed
reference.

A model is handed a configured TypeScript project and builds the game the
specification describes inside it. How much of the build the project hands over
depends on the engine the run selects.

## Engines

The case supports three engines and seeds a different project for each, which is
what the manifest's `[workspaces]` table is for:

| Engine | What the seeded project supplies |
| --- | --- |
| `none` | The toolchain configuration and `index.html`, and nothing else. There is no `src/`: the model writes the game and the runtime under it, meaning the frame loop, canvas fit, input, audio, the overlay and the `window.__carom` surface. |
| `simple-2d` | The [Simple 2D](/engines/simple-2d/) package, vendored at seed time, plus `src/constants.ts` and `src/main.ts`. The model writes `src/game.ts`: the state, the debug surface `specs/instrumentation.md` specifies, and the three functions. Its `initialize` returns the surface beside the state as `[state, debug]`, which the engine serves from `engine.debug`. The engine holds the state by value. `update` is handed it read-only (`DeepReadonly<CaromState>`) and returns the next state, `render` is handed that state read-only, and the surface's operations take the state the same way: a pose returns the next state, driven through `engine.apply`, and a reading returns what it read, `snapshot(engine.state)`. |
| `structured-2d` | The [Structured 2D](/engines/structured-2d/) package, vendored the same way, plus `src/constants.ts` and `src/main.ts`. Its constants also name the level names, the actor tags, the action bindings and the cue names. The model writes `src/game.ts`: the `GameDefinition` the engine drives, holding its levels, its game mode(s), its actors and the controllers that drive the paddles, plus the debug surface its instance's `initialize` returns and the `BACKGROUND` color `src/main.ts` hands the engine. |

The game all three projects describe is the same one, so the review items are the
same under any engine and a score recorded under one is comparable with a score
recorded under another. The specs and the validators branch where the deliverable
differs.

## Contents

| Path                   | Seeded to run? | Purpose                                                                                            |
| ---------------------- | -------------- | -------------------------------------------------------------------------------------------------- |
| `workspaces/`          | Yes            | The starter TypeScript project, `<variant>/<engine>/`, seeded at the run root.                     |
| `specs/`               | Yes            | The spec handed to the model, by concern.                                                          |
| `prompt.hbs`           | No             | Rendered into the model's prompt; not seeded.                                                      |
| `validation/`          | No             | The case's Vitest validators, one project per engine (`<engine>/`).                                |
| `references/`          | No             | The authored, correct build, `<engine>/<variant>/`. Never seeded.                                  |
| `validation-baseline/` | No             | The validators' media captured against the reference, `<engine>/<variant>/`, shown beside a run's. |
| `test-case.toml`       | No             | Manifest: workspaces, engines, toolchain, specs, domains, review items.                            |
| `variants/`            | No             | One TOML file per variant (listed in `variants`).                                                  |
| `description.md`       | No             | The site-facing introduction on the case's detail page.                                            |
| `changelog.md`         | No             | What changed from `v2.1.0`.                                                                        |
| `README.md`            | No             | This overview.                                                                                     |

The specification is split across `specs/` by concern, and every file is seeded
for every variant:

- `overview.md`
- `playfield.md` — the field, paddles, ball, and obstacles.
- `balls.md` — the ball, serving, and physics.
- `ui.md` — the menus, screens, scoring, and audio.
- `modes/single-player.md` and `modes/versus.md` — the two ways to play, with
  their controls, HUD, and the AI in Solo.
- `state.md` — the shape of the game's state.
- `instrumentation.md`
- `showcase.md` — the player-facing description and captured carousel the
  finished game ships beside its source.

Every spec is an `.hbs` template rendered before it lands, on two axes.
`variant.slug` selects the obstacles the game has and how many balls ricochet
between them, inside `overview.md.hbs`, `playfield.md.hbs`, `balls.md.hbs`,
`ui.md.hbs`, `modes/single-player.md.hbs`, `state.md.hbs` and
`instrumentation.md.hbs`. `engine.slug` selects what the build is handed and what
it writes, inside `overview.md.hbs`, `state.md.hbs`, `instrumentation.md.hbs` and
`showcase.md.hbs`. The branching resolves at seed time, so each seeded set reads
as one self-contained game.

Under an engine that seeds one, every figure the specification fixes is exported
from the seeded `src/constants.ts` under the name the specs cite, so a spec never
restates a number the project already names. Under `none` the specs state the
figures themselves and the build names them.

## Variants

Each variant is a standalone TOML file under `variants/`, listed in order in the
manifest's `variants` key, the first of which is the default. The case offers
three variants, all rated on the same common `single-player` and `versus`
domains:

- `base` — fixed, upright obstacles and a single ball served toward the receiver.
  The reference build.
- `gyre` — obstacles that sway and rotate, so the ball bounces off tilted,
  oriented faces. It ships its own `workspaces/gyre/simple-2d` and
  `workspaces/gyre/structured-2d`, because their `src/constants.ts` documents the
  obstacle centers as base centers the live poses sway about. The obstacle clock,
  the live poses, and the `setObstacleClock` operation are carried by its branch
  of the specs.
- `multi` — three independent balls, each its own contest, with its own hold, its
  own launch at a random angle, and its own respawn on a field that never
  freezes. Balls collide with each other, and that collision has a fifth audio
  cue of its own. It ships its own `workspaces/multi/simple-2d` and
  `workspaces/multi/structured-2d`, because their constants name the home points,
  the ball count, the contact distance and the cue. The three balls in place of
  one, and the surface that addresses them by index, are carried by its branch of
  the specs.

Only the engine-backed project differs by variant. The engineless project holds
no game code for a variant to differ in, so every variant shares
`workspaces/none/`.

The checklist is common to every variant apart from the points where the variants
genuinely disagree, which each variant then states for itself. `base` and `gyre`
carry the single served ball's points: its direction, its speed, its angle, the
draw of its vertical sign, the length of the pre-serve countdown, and the
scoring, match-end and deuce rules that freeze the field on a point. `multi`
carries its own versions of the same, worded for a launch drawn over the full
circle, a hold that belongs to a ball, and a point that takes one ball out of
play while the rest of the game runs on. `gyre` adds its three obstacle-motion
points, and `multi` its six multi-ball ones and its fifth cue.

Every point on the checklist is one observable behavior with a validator whose
thresholds follow from the specs, so a build fails exactly the rule it breaks.
The reviewer's judgement lives in the per-domain ratings.

## Assets and media

This version has no assets and declares no reference mockups or proof captures.
The specs fix behavior exactly and leave the look to the build: the palette,
type, glow, HUD layout and trail styling are the model's, and a reviewer rates
them through the domains. Every checklist point is decided by the validators
under `validation/`.

The media a reviewer looks at is produced by those same validators, from
scenarios the case controls. Most points declare a replay: the draw-command
recording the runtime made while the check drove the build, written as JSON and
played back by re-issuing the operations against a canvas, so what a reviewer
scrubs is the build's own drawing. A suite arms the recorder around the section
its point is about and disarms it the moment that section ends, so a replay is
the contact, the point played out, or the paddle held still while paused, and
never the arrangement that got there. A few points declare a single image
instead, where the thing being checked is one frame: a screen's copy, a body's
visibility, the fit of the field in its window.

Capture never decides anything. A point passes or fails on its assertions, and
the replay is what a reviewer looks at afterwards to see what the build actually
drew while it did. A failing scenario still writes what it recorded.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/end-to-end/easy/carom/v3.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
