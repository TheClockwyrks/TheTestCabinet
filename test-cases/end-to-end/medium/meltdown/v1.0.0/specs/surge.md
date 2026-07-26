# Surge

## Overview

This file defines the surge, the intruders you defend against: their types, the
flyers that ignore the maze, and how a wave is built. It builds on the floor and
pathing in `specs/playfield.md`, the towers in `specs/towers.md`, and the wave
progression in `specs/gameplay.md`. Speeds are in logical pixels/second; HP and bounty
are unitless game values.

The stat numbers below are fixed; implement them exactly as written. Equally
important is the behavior: each type's defining trait, the flyer's maze-bypassing
flight, and slow-immunity.

## Shared rules

- Every unit spawns at a vent, follows the rules in `specs/playfield.md` (ground units
  walk the maze to that vent's opposite exhaust; flyers fly straight to that same
  assigned exhaust), and is removed when it dies or reaches an exhaust.
- A unit that reaches an exhaust leaks: it costs the player its leak value in lives
  and is removed (`specs/economy.md`).
- A killed unit pays its bounty in money to the player when it is killed
  (`specs/economy.md`).
- Each unit shows a small health bar (`#2ec27e`) above it that depletes as it takes
  damage. Units are drawn in colors off the temperature axis (`specs/overview.md`):
  ground intruders acid green, flyers violet, the boss deep violet.
- Per-wave scaling (HP growth as waves deepen) is defined in `specs/gameplay.md`; the
  values here are the base (Wave 1) stats.

## Intruder types

| Type | Trait | HP | Speed | Slowable? | Flies? | Bounty | Leak |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Mote | Baseline intruder | 40 | 60 | yes | no | 3 | 1 |
| Sprint | Fast, fragile | 24 | 120 | yes | no | 3 | 1 |
| Hulk | Slow, heavily armored | 220 | 38 | yes | no | 7 | 2 |
| Swarm | Tiny, arrives in dense packs | 12 | 70 | yes | no | 2 | 1 |
| Drift | Flyer, ignores the maze | 60 | 80 | yes | yes | 6 | 1 |
| Core | Boss, immune to slowing | 1600 | 30 | no | no | 90 | 5 |

- Mote: the standard unit; everything else is a variation on it. The bulk of the
  early waves.
- Sprint: half the HP, double the speed of a Mote. Sprints blow through a long maze
  quickly, so they punish a defense built only for slow tanks; a Rime line
  (`specs/towers.md`) earns its keep against them.
- Hulk: a slow wall of HP that soaks fire and leaks 2 lives if it escapes through an
  exhaust. Hulks reward concentrated, high-heat damage (a white-hot Lance or a
  Bloom-fed core), not a spread of cold guns.
- Swarm: very low HP but arrive in tight clusters (many at once), so a single Swarm
  pack floods a chokepoint. Bloom splash (`specs/towers.md`) is the natural answer,
  and a packed Swarm is exactly what heats a kill-box toward the redline.
- Drift: the flyer. It does not walk the maze: it flies in a straight line from its
  vent to that vent's opposite exhaust, over every tower and wall (`specs/playfield.md`).
  The maze cannot slow or redirect it, but any emitter can shoot it if it is in range.
  Flak (`specs/towers.md`) is the dedicated answer because it targets only flyers, so
  Drifts still force the player to budget for reliable anti-air rather than leaning
  entirely on the maze.
- Core: the boss. A massive HP pool that is immune to slowing entirely (a Rime does
  nothing to it, regardless of the Rime's heat), leaking 5 lives if it escapes through
  an exhaust. A Core appears on the milestone waves of `specs/gameplay.md` and is the
  trial of whether your hot core can actually output the damage to break it before it
  crosses the floor.

## Wave composition

Each wave releases a single intruder type: one wave is all Motes, the next all
Sprints, the next all Swarms, and so on down the roster. A wave is a timed sequence
of that one type spawned from the vents; the per-wave count, spawn timing, and vent
split are yours to design, within the progression below and in `specs/gameplay.md`.
Because the player fields many cheap towers, a real maze is a dozen-plus structures
from the opening build (`specs/towers.md`), the volume types field enough units per
wave, growing across the run, that a thin or short maze is overrun. A packed wave
crawling a long maze is the whole point, and a dense one is also what runs the guns
on it hot.

Because a wave is all one type, each wave presses one specific answer. Reading the
coming type (previewed in the build panel, `specs/gameplay.md`) and re-shaping the floor
for it is the between-wave game.

| Wave type | What the wave demands |
| --- | --- |
| Mote | Sustained volume: enough fed guns to grind a large wave down |
| Sprint | Slowing (a Rime line) or a long kill-box, or the fast rush outpaces the maze |
| Swarm | Splash (a Bloom), or the dense pack floods past single-target fire |
| Hulk | Concentrated white-hot output on one target, not a spread of cold guns |
| Drift | Dedicated anti-air (Flak), as the flyers cross straight over the maze |
| Core | Raw white-hot damage to break a boss before it reaches the exhaust |

The type each wave carries follows a set progression:

- The opening waves are Motes, light enough to teach the maze and the heat curve.
- Sprints, then Swarms, then Drifts enter over the next waves, and Hulks join once the
  run has deepened.
- From there the five ground and air types cycle, so each recurs and every wave presses
  a different answer, while counts and the per-wave HP scaling (`specs/gameplay.md`) climb
  toward the late game.
- The milestone waves (`specs/gameplay.md`) are the Core boss.

## Surge and heat system relationship

The surge and the heat system are intertwined: the denser a wave packs into your
maze, the hotter your guns run on it; a Swarm flood will redline a tight kill-box,
while a lone fast Sprint barely warms anything. So the player is always weighing not
just whether the towers can kill this wave but also whether this wave will run the
towers too hot, or leave them too cold.
