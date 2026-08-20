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

A model is handed a **complete TypeScript project** rather than a blank page, and
writes one module of it: `src/game.ts`. The project is built on the
[Simple 2D](/engines/simple-2d/) engine, which owns the frame loop, keyboard
input, audio, and the debug overlay; the game the model writes owns everything
else. See `changelog.md` for what changed from `v2.1.0` and why.

## Contents

| Path                        | Seeded to run? | Purpose                                                               |
| --------------------------- | -------------- | --------------------------------------------------------------------- |
| `workspaces/`               | **Yes**        | The starter TypeScript project, seeded at the run root.               |
| `specs/`                    | **Yes**        | The spec handed to the model, by concern.                             |
| `prompt.hbs`                | No             | Rendered into the model's prompt; not seeded.                         |
| `validation/`               | No             | The case's Vitest validators, run against the produced build.         |
| `reference-impl-simple-2d/` | No             | The authored, correct build of each variant. Never seeded.            |
| `test-case.toml`            | No             | Manifest: workspace, engine, toolchain, specs, domains, review items. |
| `variants/`                 | No             | One TOML file per variant (listed in `variants`).                     |
| `README.md`                 | No             | This overview.                                                        |

The specification is split across `specs/` by concern, and every file is seeded
for every variant: `overview.md`, `playfield.md` (the field, paddles, ball, and
obstacles), `balls.md` (the ball, serving, and physics), `ui.md` (the menus,
screens, scoring, and audio), `modes/single-player.md` and `modes/versus.md` (the
two ways to play, with their controls, HUD, and — for Solo — the AI), and
`instrumentation.md`. What a variant changes is not a separate file but a branch
inside `specs/playfield.md.hbs` and `specs/instrumentation.md.hbs`, rendered on
the selected variant's slug before they land. Because the branching resolves at
seed time, each variant's seeded set reads as one self-contained game with no
cross-variant language.

Every figure the specification fixes is exported from the seeded
`src/constants.ts` under the name the specs cite, so a spec never restates a
number the project already names.

## Variants

Each variant is a standalone TOML file under `variants/`, listed in order in the
manifest's `variants` key (the first is the default). The case offers two
variants, both rated on the same common `single-player` and `versus` domains (no
variant adds a domain of its own):

- `base` — fixed, upright obstacles and a single ball served toward the receiver.
  The reference build.
- `gyre` — obstacles that sway and rotate, so the ball bounces off tilted,
  oriented faces. It ships its own `workspaces/gyre`, because its state carries
  the obstacle clock and both obstacles' live poses, and its debug API adds
  `setObstacleClock`.

The `multi` variant of `v2.1.0` is not carried forward; `changelog.md` explains
why, and `v2.1.0` is frozen and still offers it.

## Assets and media

This version has **no assets** and declares no reference mockups or proof
captures: every screen is left to the model's design, guided by the palette and
measurements the specs name, and graded by a person. The objective points are
decided by the validators under `validation/`.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/end-to-end/easy/carom/v3.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
