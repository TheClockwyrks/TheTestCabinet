# Pong — `v1.0.0` (Carom)

This is version `v1.0.0` of the **Pong** test case. The implemented game is an
original paddle-and-ball duel titled **Carom**: classic paddle mechanics plus a
**spin** mechanic (a paddle's motion curves the ball) and two **static
obstacles** in the field. A **Frenzy** mode adds an uncapped speed ramp.

Pong is the catalog slug for this lineage of paddle-and-ball cases; `Carom` is
the original in-game title. The case is inspired by classic paddle games but is
not a clone of any of them — the name, look, spin mechanic, and obstacle layout
are original to The Test Cabinet.

## Why Pong as the first test case

Pong is the simplest game in the catalog, which makes it the right case to
establish the test case format and exercise the harness end to end. It still
asks for a real, polished, rendered game with multiple screens, an AI opponent,
a physics loop, and a distinctive mechanic — enough to produce a meaningful run
without the scale of the harder cases.

## Contents

| Path                   | Seeded to run? | Purpose                                            |
| ---------------------- | -------------- | -------------------------------------------------- |
| `specs/`               | **Yes**        | The spec handed to the model, by concern.          |
| `prompt.hbs`           | No             | Rendered into the model's prompt; not seeded.      |
| `reference/` (source)  | No             | Canonical visual mockups; rendered to screenshots. |
| reference screenshots  | **Yes**        | Rendered from `reference/`; seeded as targets.     |
| `validation.md`        | No             | What the harness checks automatically.             |
| `README.md`            | No             | This overview.                                     |

The specification is split across `specs/` by concern: `overview.md`,
`playfield.md`, `physics.md`, `flow.md`, and the mode specs under `specs/modes/`.
The common specs (overview, playfield, physics, flow, and `modes/standard.md`)
are seeded for every variant; each variant adds at most one extra mode spec. The
case offers four variants — `base` (standard modes only), `frenzy` (adds the
escalating Frenzy mode), `multi` (adds a three-ball mode with ball-to-ball
collisions), and `gyre` (adds a mode whose obstacles oscillate and rotate, so the
ball bounces off tilted, oriented faces).

This version has **no assets**: Pong is simple enough to leave all visuals to the
model, guided by the palette and measurements in the specs and by the seeded
reference screenshots.

The seeded specs and the rendered reference screenshots are copied into a run's
repository (plus assets, when a case has them). The reference *source* mockups
are not seeded, so a model builds the UI from the specs and the screenshots
rather than copying the mockup code.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/pong/v1.0.0/`). Each version is self-contained and immutable once a
run references it; design revisions land as new version folders.
