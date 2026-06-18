# Snake — `v1.0.0` (Coil)

This is version `v1.0.0` of the **Snake** test case. The implemented game is an
original grid-and-growth game titled **Coil**: classic grid-locked snake
mechanics plus a **combo** multiplier (pellets eaten in quick succession score
more) and three extra modes — **Wrap** (the board edges wrap into tunnels),
**Maze** (fixed fatal interior obstacles), and **Feast** (a periodic,
time-limited bonus orb).

Snake is the catalog slug for this lineage of grid-and-growth cases; `Coil` is
the original in-game title. The case is inspired by classic snake games but is
not a clone of any of them — the name, look, and combo mechanic are original to
The Test Cabinet.

## Why Snake

Snake is one of the simplest games in the catalog, which makes it a good low-end
anchor alongside Pong. It still asks for a real, polished, rendered game: a
correct fixed-timestep loop, grid-locked movement and turning, the subtle
self-collision and food-placement rules that are easy to get *almost* right, a
decaying combo, persistent high scores, and multiple screens — enough to produce
a meaningful run without the scale of the harder cases.

## Contents

| Path                   | Seeded to run? | Purpose                                            |
| ---------------------- | -------------- | -------------------------------------------------- |
| `specs/`               | **Yes**        | The spec handed to the model, by concern.          |
| `prompt.hbs`           | No             | Rendered into the model's prompt; not seeded.      |
| `reference/` (source)  | No             | Canonical visual mockups; rendered to screenshots. |
| reference screenshots  | **Yes**        | Rendered from `reference/`; seeded as targets.     |
| `test-case.toml`       | No             | Manifest: specs, variants, checks, review items.   |
| `README.md`            | No             | This overview.                                     |

The specification is split across `specs/` by concern: `overview.md`,
`playfield.md`, `mechanics.md`, `flow.md`, and the mode specs under
`specs/modes/`. The common specs (overview, playfield, mechanics, flow, and
`modes/standard.md`) are seeded for every variant; each variant adds at most one
extra mode spec. The case offers four variants — `base` (Classic mode only),
`wrap` (adds Wrap mode), `maze` (adds Maze mode), and `feast` (adds Feast mode).

This version has **no assets**: Coil is simple enough to leave all visuals to
the model, guided by the palette and measurements in the specs and by the seeded
reference screenshots.

The seeded specs and the rendered reference screenshots are copied into a run's
repository (plus assets, when a case has them). The reference *source* mockups
are not seeded, so a model builds the UI from the specs and the screenshots
rather than copying the mockup code.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/snake/v1.0.0/`). Each version is self-contained and immutable once
a run references it; design revisions land as new version folders.
