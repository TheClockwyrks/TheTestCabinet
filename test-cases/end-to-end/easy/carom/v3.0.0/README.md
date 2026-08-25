# Carom — `v3.0.0`

This is version `v3.0.0` of the **Carom** test case. The implemented game is an
original paddle-and-ball duel titled **Carom**: classic paddle mechanics plus a
**spin** mechanic (a paddle's motion curves the ball) and two **obstacles** in the
field. Each variant plays the same two ways — Solo and Versus — and changes the
_rules of the game itself_ rather than adding a separate menu mode.

`carom` is the catalog slug for this lineage of paddle-and-ball cases, and the
game's in-fiction title; the manifest pins the case's identity to its original
`pong` slug so runs published before the folder was renamed stay attached to it.
The case is inspired by classic paddle games but is not a clone of any of them —
the name, look, spin mechanic, and obstacle layout are original to The Test
Cabinet.

## What this version asks for

A model is handed a configured TypeScript project rather than a blank page, and
builds the game the specification describes inside it. How much of the build the
project hands over depends on the engine the run selects. See `changelog.md` for
what changed from `v2.1.0` and why.

## Engines

The case supports two engines and seeds a different project for each, which is
what the manifest's `[workspaces]` table is for:

| Engine | What the seeded project supplies |
| --- | --- |
| `none` | The toolchain configuration and `index.html`, and nothing else. There is no `src/`: the model writes the runtime — the frame loop, canvas fit, input, audio, the overlay and the `window.__carom` surface — and the game on top of it. |
| `simple-2d` | The [Simple 2D](/engines/simple-2d/) package, vendored at seed time, plus `src/constants.ts` and `src/main.ts`. The model writes `src/game.ts` — the state, the debug surface `specs/instrumentation.md` specifies, and the three functions — and its `initialize` returns the surface beside the state as `[state, debug]`, which the engine serves from `engine.debug`. The engine holds the state by value: `update` is handed it read-only (`DeepReadonly<CaromState>`) and returns the next state, `render` is handed that state read-only, and the surface's operations take the state the same way — a pose returns the next state (driven through `engine.apply`), a reading returns what it read (`snapshot(engine.state)`). |

The game both projects describe is the same one, so the review items are the same
under either engine and a score recorded under one is comparable with a score
recorded under the other. The specs and the validators branch where the
deliverable differs.

## Contents

| Path                   | Seeded to run? | Purpose                                                                                            |
| ---------------------- | -------------- | -------------------------------------------------------------------------------------------------- |
| `workspaces/`          | **Yes**        | The starter TypeScript project, `<variant>/<engine>/`, seeded at the run root.                     |
| `specs/`               | **Yes**        | The spec handed to the model, by concern.                                                          |
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
for every variant: `overview.md`, `playfield.md` (the field, paddles, ball, and
obstacles), `balls.md` (the ball, serving, and physics), `ui.md` (the menus,
screens, scoring, and audio), `modes/single-player.md` and `modes/versus.md` (the
two ways to play, with their controls, HUD, and the AI in Solo), `state.md` (the
shape of the game's state), and `instrumentation.md`.

Every spec is an `.hbs` template rendered before it lands, on two axes.
`variant.slug` selects the obstacles the game has and how many balls ricochet
between them, inside `overview.md.hbs`, `playfield.md.hbs`, `balls.md.hbs`,
`ui.md.hbs`, `modes/single-player.md.hbs`, `state.md.hbs` and
`instrumentation.md.hbs`. `engine.slug` selects what the build is handed and what
it writes, inside `overview.md.hbs`, `state.md.hbs` and `instrumentation.md.hbs`.
Because the branching resolves at seed time, each seeded set reads as one
self-contained game with no alternative in view.

Under `simple-2d`, every figure the specification fixes is exported from the
seeded `src/constants.ts` under the name the specs cite, so a spec never restates
a number the project already names. Under `none` the specs state the figures
themselves and the build names them.

## Variants

Each variant is a standalone TOML file under `variants/`, listed in order in the
manifest's `variants` key (the first is the default). The case offers three
variants, all rated on the same common `single-player` and `versus` domains (no
variant adds a domain of its own):

- `base` — fixed, upright obstacles and a single ball served toward the receiver.
  The reference build.
- `gyre` — obstacles that sway and rotate, so the ball bounces off tilted,
  oriented faces. It ships its own `workspaces/gyre/simple-2d`, because its
  `src/constants.ts` documents the obstacle centers as base centers the live
  poses sway about; the obstacle clock, the live poses, and the
  `setObstacleClock` operation are carried by its branch of the specs.
- `multi` — three independent balls, each its own contest: its own hold, its own
  launch at a random angle, and its own respawn on a field that never freezes.
  Balls collide with each other, and that collision has a fifth audio cue of its
  own. It ships its own `workspaces/multi/simple-2d`, because its constants name
  the home points, the ball count, the contact distance and the cue; the three
  balls in place of one, and the surface that addresses them by index, are
  carried by its branch of the specs.

Only the engine-backed project differs by variant. The engineless project holds
no game code for a variant to differ in, so every variant shares
`workspaces/none/`.

The checklist is common to every variant apart from the points where the variants
genuinely disagree, which each variant then states for itself. `base` and `gyre`
carry the single served ball's points — its direction, its speed, its angle, the
draw of its vertical sign, the length of the pre-serve countdown, and the
scoring, match-end and deuce rules that freeze the field on a point. `multi`
carries its own versions of the same, worded for a launch drawn over the full
circle, a hold that belongs to a ball, and a point
that takes one ball out of play while the rest of the game runs on; `gyre` adds its
three obstacle-motion points, and `multi` its six multi-ball ones and its fifth
cue.

Every point on the checklist is one observable behavior with a validator whose
thresholds follow from the specs, so a build fails exactly the rule it breaks. The
reviewer's judgement lives in the per-domain ratings, not in the checklist.

## Assets and media

This version has **no assets** and declares no reference mockups or proof
captures. The specs fix behavior exactly and leave the look to the build: the
palette, type, glow, HUD layout and trail styling are the model's, and a reviewer
rates them through the domains. Every checklist point is decided by the
validators under `validation/`.

The media a reviewer looks at is produced by those same validators, from
scenarios the case controls, rather than asked of the build. Most points declare
a **replay**: the draw-command recording the runtime made while the check drove
the build, written as JSON and played back by re-issuing the operations against a
canvas — so what a reviewer scrubs is the build's own drawing rather than a
re-shoot of it. A suite arms the recorder around the section its point is about
and disarms it the moment that section ends, so a replay is the contact, the
point played out, or the paddle held still while paused, and never the
arrangement that got there. A few points declare a single **image** instead,
where the thing being checked is one frame: a screen's copy, a body's
visibility, the fit of the field in its window.

Capture never decides anything. A point passes or fails on its assertions, and
the replay is what a reviewer looks at afterwards to see what the build actually
drew while it did — including when the check failed, since a failing scenario
still writes what it recorded.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/end-to-end/easy/carom/v3.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
