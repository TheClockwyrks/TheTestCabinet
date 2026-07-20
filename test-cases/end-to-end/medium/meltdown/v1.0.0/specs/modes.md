# Modes

## Overview

This file defines the modes a player can start from the main menu, the difficulties
of the standard mode, and the two menus that choose them. It builds on the floor in
`specs/reactor.md`, the heat system in `specs/heat.md`, the towers in
`specs/towers.md`, the surge in `specs/surge.md`, the controls in `specs/controls.md`,
the economy in `specs/economy.md`, and the run in `specs/waves.md`.

Every mode uses the common systems exactly as the other specs define them: the tile
floor, mazing and live re-pathing, heat as power and the trip, surface cooling, the
Forge and Sink, the tower roster and upgrades, the surge types and flyers, the
mouse-and-keyboard controls, the economy, and the win/lose states. A mode changes only
the values called out for it below; nothing else is overridden.

The numeric values in this file are fixed; implement them exactly as written. The
wording of the on-screen mode and difficulty descriptions, and the layout of the
menus, are yours (`specs/states.md`, Required menus): what is required is that the
content and navigation below are present.

## The main menu and the mode flow

The main menu's play action is a single PLAY entry (followed by HOW TO PLAY;
`specs/states.md`, Game states). PLAY does not start a game directly; it opens the
mode select menu. From there:

- Choosing Containment (the standard mode) opens the difficulty select menu; choosing
  a difficulty starts a Containment game at it.
- Choosing any special mode starts that mode immediately.

Both menus are defined as states in `specs/states.md` (Game states, Required menus).
This file supplies their content: the modes and difficulties listed below, and the
information each must show about itself.

## Containment (the standard mode)

Containment is the single-floor defense: you hold the one reactor floor of
`specs/reactor.md` against every wave of the surge, building and re-shaping a maze of
emitters, pacing their heat to keep your guns in their redline plateau, hot but
online, by spacing, orienting, and cooling them, and answering each wave's single
type, slowing a Sprint wave, splashing a Swarm wave, concentrating heat on a Hulk
wave, flaking a Drift wave, and breaking the Core bosses, until the final wave is
cleared or the reactor breaches.

Containment is played at one of three difficulties, chosen on the difficulty select
menu. A difficulty sets only the starting money and the number of waves
(`specs/waves.md`); every other value, lives (20), the per-wave HP scaling, the
economy, the surge, and the towers, is unchanged.

| Difficulty | Starting money | Waves |
| --- | --- | --- |
| Easy | 350 | 15 |
| Medium | 250 | 20 |
| Hard | 200 | 26 |

- Medium is the reference balance: 250 opening money (about 16 Arc towers,
  `specs/economy.md`) over the full 20 waves.
- Easy opens with more money and runs fewer waves.
- Hard opens with less money and runs a longer siege; because HP scales per wave
  (`specs/waves.md`), its later waves climb well past a Medium run's.

The difficulty select menu lets the player read what each difficulty changes, its
starting money and its wave count, before choosing it, and offers a way back to the
mode select menu.

## Special modes

Each special mode is a fixed challenge (no difficulty choice) that layers a small set
of rule changes on Containment's floor and systems. The mode select menu lets the
player read each mode's description before choosing it.

- The Hundred. One continuous onslaught of exactly 100 surge units in a single wave,
  with no per-wave build phases and no between-wave interest. There is one untimed
  opening build phase (`specs/waves.md`); pressing Start releases the whole onslaught,
  and the mode is won when all 100 units have died or leaked with at least one life
  left. Because there is no per-wave HP ramp, every unit's HP is multiplied by a flat
  factor so the onslaught bites (an unscaled wave would be trivial). Starting money
  600; 20 lives. The wave readout reads the onslaught rather than `WAVE n / N`.
- Deep Pockets. Start flush with 10,000 money, enough to build a full maze in the
  opening phase, but earn no interest between waves (`specs/economy.md`). The standard
  20-wave Containment progression otherwise. 20 lives.
- Bottleneck. Building is restricted to a marked central zone of the floor; a placement
  any tile of which falls outside the zone is refused and shown invalid, exactly like
  any other invalid placement (`specs/controls.md`, `specs/reactor.md`). The rest of
  the floor stays open for the surge to walk. The zone is drawn so the player can see
  where they may build, and it spans both straight vent-to-exhaust corridors so the
  maze still matters. The standard 20-wave progression; starting money 300; 20 lives.
- Sudden Death. You start with 1 life: a single leak breaches the reactor and ends the
  game (`specs/economy.md`). The standard 20-wave progression; starting money 300.
