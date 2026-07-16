# Spectra — Sortie

This file defines the game's mode and its main-menu entry. It builds on the stage
in `specs/playfield.md`, polarity in `specs/polarity.md`, the controls in
`specs/controls.md`, the drones in `specs/enemies.md`, and the wave flow in
`specs/flow.md`.

## Menu entry

This mode adds the following entry to the main menu (see Game states in
`specs/flow.md`), before `HOW TO PLAY`:

- `LAUNCH`

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a mode, and is always
shown last in the menu.)

## Mode

- **Sortie** — the single-ship defense. You pilot the resonator-fighter against
  wave after wave of the drone swarm, flipping bands to match what you fire at and
  to shield what fires at you, clearing each stage and pressing into faster,
  deeper stages until your last life is lost.

Sortie uses every system exactly as the common specs define it, with no overrides:

- the **two bands** and the **match-to-destroy** rule from `specs/polarity.md`,
  with a **mismatched** shot — one opposite the drone's current band —
  **wasted**: it is absorbed and the bullet consumed, dealing no damage and
  having no other effect (you cannot harm a drone of the band you are not tuned
  to);
- the **dual-use shield** and the **resonance meter and discharge** from
  `specs/polarity.md`;
- the movement, firing, and flip controls from `specs/controls.md`;
- the full set of three drones — the Shard, the Flux, and the Prism, including the
  Prism's spectral inversion — from `specs/enemies.md`;
- the stages, challenge stages, scoring, lives, and stage scaling from
  `specs/flow.md`.
