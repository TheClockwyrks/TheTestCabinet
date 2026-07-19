# Spectra — Stages, challenge stages, scoring, lives, and scaling

This file defines the wave and stage progression, the challenge stages, scoring,
lives, and stage scaling. It refers to the stage in `specs/playfield.md`, polarity
in `specs/polarity.md`, the controls in `specs/controls.md`, the drones in
`specs/drones.md`, the game states in `specs/states.md`, and the mode in
`specs/mode.md`.

## Stages and waves

The game is a sequence of stages, numbered `STAGE 1`, `STAGE 2`, and so on. Each
standard stage is one wave: the formation flies in (`specs/drones.md`), the drones
assault you, and the stage is cleared when every drone in the wave is destroyed.
Clearing a stage advances to the next, harder one.

Every third stage (`STAGE 3`, `STAGE 6`, `STAGE 9`, and so on) is a challenge
stage instead of a normal wave (below).

## Challenge stages

A challenge stage is a non-firing flyover, a shooting-gallery breather that still
exercises polarity:

- It is announced with a `CHALLENGING STAGE` banner, then a fixed sequence of
  flyover groups enters. Each group sweeps across the field along set paths and
  exits; the drones never fire, and contact with them costs no life during a
  challenge stage.
- Single-band groups. Each group is entirely one band, and groups alternate bands
  (cyan, then magenta, and so on), so you pre-flip to a group's band and rake it
  before the next arrives. Use about 5 groups of 8 drones (40 total).
- Scoring. Each drone destroyed scores `100`. Destroying all of them earns a
  `10000` perfect bonus; otherwise the score is just the per-drone total. After the
  last group exits, a brief result (`PERFECT!` or the hit count) shows, then play
  advances to the next stage.

You still move, fire, flip, and (if charged) discharge during a challenge stage.

## Scoring

- Shard: `50` in formation, `100` while diving.
- Flux: `80` in formation, `160` while diving.
- Prism: `100` for the shell, `400` for the core kill.
- Challenge drone: `100` each, plus the `10000` perfect bonus.
- Stage cleared: a `1000`-point bonus for clearing a standard wave.
- A discharge (`specs/polarity.md`) scores each drone it destroys as a diving kill.

Score accumulates across the whole game (all stages of one run) and shows in the
HUD. Scores are not persisted between sessions.

## Lives and getting hit

- You start a game with 3 lives.
- You lose a life when an opposite-band enemy bullet hits you, or any drone's body
  contacts you (`specs/polarity.md`). A same-band bullet is absorbed harmlessly and
  never costs a life.
- On losing a life (if lives remain): a brief `READY` hold plays, then the ship
  reappears at the center of its lane and play resumes. The wave continues where it
  was: the formation, the drones, and any active dive persist; they are not reset.
  Your resonance meter is kept (it is not reset by death; `specs/polarity.md`).
- An extra life is awarded once, at `20000` points.
- Losing your last life ends the game (Game over, `specs/states.md`).

## Stage scaling

Deeper stages are more dangerous, scaling with the stage number `s` (with `s = 1`
the first stage). On every standard stage:

- Drone speed (entrance and dive, `specs/drones.md`) is multiplied by
  `1 + 0.06 * (s - 1)`, capped at `1.50`.
- Enemy bullet speed is multiplied by `1 + 0.04 * (s - 1)`, capped at `1.40`.
- Dive cadence shortens: the gap between dives is scaled by
  `max(0.55, 1 - 0.05 * (s - 1))`, so the assault presses harder.
- The Flux flips faster: its hold time (`specs/drones.md`) is
  `max(1.0, 1.6 - 0.05 * (s - 1))` seconds (the `0.4 s` shimmer is unchanged).
- The formation grows toward the slot capacity (`specs/playfield.md`), leaning more
  on Fluxes and Prisms.
- All other rules (the matching rules, the shield, brightness of bands, the
  resonance meter and discharge) are unchanged.

Challenge stages do not scale; they are the same flyover whenever they occur.
