# Carom — `v2.1.0`

This is version `v2.1.0` of the **Carom** test case. The implemented game is an
original paddle-and-ball duel titled **Carom**: classic paddle mechanics plus a
**spin** mechanic (a paddle's motion curves the ball) and two **obstacles** in
the field. Each variant plays the same two ways — Solo and Versus — and changes
the *rules of the game itself* rather than adding a separate menu mode.

`carom` is the catalog slug for this lineage of paddle-and-ball cases, and the
game's in-fiction title. The case is inspired by classic paddle games (such as
Pong) but is not a clone of any of them — the name, look, spin mechanic, and
obstacle layout are original to The Test Cabinet.

## Why Pong as the first test case

Pong is the simplest game in the catalog, which makes it the right case to
establish the test case format and exercise the harness end to end. It still
asks for a real, polished, rendered game with multiple screens, an AI opponent,
a physics loop, and a distinctive mechanic — enough to produce a meaningful run
without the scale of the harder cases.

## Contents

| Path                  | Seeded to run? | Purpose                                                            |
| --------------------- | -------------- | ------------------------------------------------------------------ |
| `specs/`              | **Yes**        | The spec handed to the model, by concern.                          |
| `prompt.hbs`          | No             | Rendered into the model's prompt; not seeded.                      |
| `reference/` (source) | No             | Canonical visual mockups; rendered to screenshots.                 |
| reference screenshots | **Yes**        | Rendered from `reference/`; seeded as targets.                     |
| `test-case.toml`      | No             | Manifest: common specs, references, checks, domains, review items. |
| `variants/`           | No             | One TOML file per variant (listed in `variants`).                  |
| `README.md`           | No             | This overview.                                                     |

The specification is split across `specs/` by concern, and every file is seeded
for every variant: `overview.md`, `playfield.md` (the field, paddles, ball, and
obstacles), `balls.md` (the balls, serving, and physics), `ui.md` (the menus,
screens, scoring, and audio), `modes/single-player.md` and `modes/versus.md` (the
two ways to play, with their controls, HUD, and — for Solo — the AI),
`instrumentation.md`, and `proof.md`. The two things a variant changes — the field
with its obstacles, and the balls/serving/physics — are not separate files but
branches inside `specs/playfield.md.hbs` and `specs/balls.md.hbs` (and a little
ball-count wording in `specs/instrumentation.md.hbs`), rendered on the selected
variant's slug before they land. Because the branching resolves at seed time, each
variant's seeded set reads as one self-contained game with no cross-variant
language.

Each variant is a standalone TOML file under `variants/`, listed in order in the
manifest's `variants` key (the first is the default). The case offers three
variants, all rated on the same common `single-player` and `versus` domains (no
variant adds a domain of its own):

- `base` — fixed, upright obstacles and a single ball served toward the receiver.
  The reference build.
- `gyre` — obstacles that sway and rotate, so the ball bounces off tilted,
  oriented faces.
- `multi` — three independent balls at once, each its own contest: distinct
  centerline spawns, per-ball respawns, random-360&deg; launches, and ball-to-ball
  collisions.

This version has **no assets**: Pong is simple enough to leave all visuals to the
model, guided by the palette and measurements in the specs and by the seeded
reference screenshots.

The seeded specs and the rendered reference screenshots are copied into a run's
repository (plus assets, when a case has them). The reference *source* mockups
are not seeded, so a model builds the UI from the specs and the screenshots
rather than copying the mockup code.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/carom/v2.1.0/`). Each version is self-contained and immutable once
a run references it; design revisions land as new version folders.
