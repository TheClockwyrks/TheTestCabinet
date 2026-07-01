# Surge

## Overview

This file defines the **surge** — the intruders you defend against: their types,
the flyers that ignore the maze, and how a wave is built. It builds on the floor
and pathing in `specs/playfield.md`, the towers in `specs/towers.md`, and the
wave progression in `specs/flow.md`. Speeds are in logical pixels/second; HP and
bounty are unitless game values.

The stat numbers below are the **starting balance** and are meant to be tuned by
play; implement them as written but keep them easy to adjust. What must be right
is the **behavior**: each type's defining trait, the flyer's maze-bypassing
flight, and slow-immunity.

## Shared Rules

- Every unit spawns at an **intake**, follows the rules in `specs/playfield.md`
  (ground units walk the maze to the nearest reachable exhaust; flyers fly
  straight), and is removed when it dies or reaches an exhaust.
- A unit that reaches an exhaust **leaks**: it costs the player its leak value
  in lives and is removed (see `specs/flow.md`).
- A killed unit pays its **bounty** in money to the player when it is killed
  (`specs/flow.md`).
- Each unit shows a small **health bar** (`#2ec27e`) above it that depletes as
  it takes damage. Units are drawn in colors off the temperature axis
  (`specs/overview.md`): ground intruders acid green, flyers violet, the boss
  deep violet.
- Per-wave scaling (HP growth as waves deepen) is defined in `specs/flow.md`;
  the values here are the **base** (Wave 1) stats.

## Intruder Types

| Type | Trait | HP | Speed | Slowable? | Flies? | Bounty | Leak |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Mote** | Baseline intruder | 40 | 60 | yes | no | 4 | 1 |
| **Sprint** | Fast, fragile | 24 | 120 | yes | no | 4 | 1 |
| **Hulk** | Slow, heavily armored | 220 | 38 | yes | no | 10 | 2 |
| **Swarm** | Tiny, arrives in dense packs | 12 | 70 | yes | no | 2 | 1 |
| **Drift** | **Flyer** — ignores the maze | 60 | 80 | yes | yes | 8 | 1 |
| **Core** | **Boss** — immune to slowing | 1600 | 30 | no | no | 120 | 5 |

- **Mote** — the standard unit; everything else is a variation on it. The bulk
  of the early waves.
- **Sprint** — half the HP, double the speed of a Mote. Sprints blow through a
  long maze quickly, so they punish a defense built only for slow tanks; a
  **Rime** line (`specs/towers.md`) earns its keep against them.
- **Hulk** — a slow wall of HP that soaks fire and leaks **2** lives if it
  escapes through an exhaust. Hulks reward concentrated, high-heat damage (a
  white-hot **Lance** or a **Bloom**-fed core), not a spread of cold guns.
- **Swarm** — very low HP but arrive in tight clusters (many at once), so
  a single Swarm pack floods a chokepoint. **Bloom** splash (`specs/towers.md`)
  is the natural answer, and a packed Swarm is exactly what heats a kill-box
  toward the redline.
- **Drift** — the **flyer**. It does **not** walk the maze: it flies in a
  straight line from its intake to the nearest exhaust, over every tower
  and wall (`specs/playfield.md`). No maze and no ground emitter can touch it;
  only a **Flak** (`specs/towers.md`) can shoot it down. Drifts force the player
  to spend on anti-air rather than leaning entirely on the maze.
- **Core** — the **boss**: a massive HP pool that is **immune** to slowing
  entirely (a **Rime** does nothing to it, regardless of the Rime's heat),
  leaking **5** lives if it escapes through an exhaust. A Core appears on the
  milestone waves of `specs/flow.md` and is the test of whether your hot core
  can actually output the damage to break it before it crosses the floor.

## Wave Composition

A wave is a timed sequence of units released from the intakes (the exact spawn
timing and intake split per wave is yours to design, within
`specs/flow.md`'s progression):

- Early waves are mostly Motes and Sprints, light enough to teach the
  maze and the heat curve.
- Swarm packs and Hulks enter as the waves deepen, pressing splash and
  concentrated heat respectively.
- Drift flyers begin appearing from the mid game on, so a defense with no
  anti-air starts leaking.
- A Core boss anchors each milestone wave (`specs/flow.md`), with the surge
  around it growing toward the late game.
- A wave should mix types so the player cannot answer everything with one tower:
  Sprints want slowing, Hulks want concentrated heat, Swarms want splash, Drifts
  want Flak, and a Core wants raw white-hot output. Reading the next wave's
  makeup (previewed in the build panel, `specs/flow.md`) and re-shaping the
  floor for it is the between-wave game.

## Reading the surge against the heat system

The surge and the heat system are intertwined: the denser a wave packs into
your maze, the hotter your guns run on it; a Swarm flood will redline a tight
kill-box, while a lone fast Sprint barely warms anything. So the player is
always weighing not just "can my towers kill this wave" but also "will this
wave run my towers too hot, or leave them too cold".
