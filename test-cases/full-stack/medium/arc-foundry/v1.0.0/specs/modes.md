# Modes

## Overview

This file defines the difficulty a player chooses before a run, and the two menus
that lead into it: the map select and the difficulty select. It builds on the board
and the three maps in `specs/board.md`, the Load and its per-wave HP scaling in
`specs/enemies.md`, and the economy, campaign, and win/lose states in `specs/flow.md`.

There is exactly one campaign (SALVAGE) and no special modes: every run plays the
same campaign, roster, economy, and build loop. Difficulty changes only the number of
waves and how tough the Load grows; nothing else is overridden. The tile floor, the
ordered-waypoint mazing (with its 4-tile waypoint platforms) and live re-pathing, the
scrap-press build, the keep-one-per-level rule, inert blockers, the combine climb, the
UPGRADE QUALITY track, the quality ladder, the eight components (and the combination
towers), the economy, and Grid Integrity all work exactly as their specs define them,
at every difficulty.

The numeric values in this file are fixed; implement them exactly as written. The
wording of the on-screen descriptions and the layout of the menus are yours (see
`specs/flow.md`, Required menus): what is required is that the content and navigation
below are present.

## The menu flow

The title menu's play action is a single SALVAGE entry (followed by HOW TO PLAY; see
Game states in `specs/flow.md`). Choosing it does not start a game directly; it opens
the map select menu. From there:

- Choosing one of the three maps (`specs/board.md`) opens the difficulty select menu.
- Choosing a difficulty starts a run on the selected map at that difficulty.

Both menus are defined as states in `specs/flow.md` (Game states, Required menus).
This file supplies their content: the maps and difficulties listed below, and the
information each must show about itself.

## Map select

The map select menu lists the three maps of `specs/board.md`: The Substation, The
Switchyard, and The Transformer Yard (which adds two fixed transformer housings that
pre-shape the maze). Each map carries six waypoints (`WP1..WP6`, `specs/board.md`), a
long, loopy route on which mazing matters much. Each map plays the same campaign,
economy, roster, and scaling; only the topology (the waypoint chain and any fixed
housings) differs.

The menu must show each map so the player can tell them apart before choosing (a
small preview of the waypoint layout is welcome), and must offer a way back to the
title menu.

## Difficulty select

A run is played at one of three difficulties, chosen on the difficulty select menu. A
difficulty sets only the number of waves and the enemy toughness, the per-wave
HP-scaling constants `baseMult`, `k`, `c`, and `r` (`specs/enemies.md`). Every other
value is identical across difficulty: starting Charge (`10`), Grid Integrity (`20`),
builds-per-level (`5`, placement free), the Refinement track, the Load roster, the
economy, and the components are all unchanged. Only the wave count and the HP scaling
move.

| Difficulty | Waves `N` | Base mult `baseMult` | Linear ramp `k` | Surcharge weight `c` | Surcharge base `r` | Milestone waves |
| --- | --- | --- | --- | --- | --- | --- |
| **Easy** | `40` | `0.20` | `0.50` | `0.08` | `1.09` | `20`, `40` |
| **Medium** | `50` | `0.22` | `1.17` | `0.28` | `1.145` | `25`, `50` |
| **Hard** | `60` | `0.24` | `1.30` | `0.22` | `1.15` | `30`, `60` |

A unit's HP on wave `w` is
`baseHP × baseMult × [ (1 + k × (w − 1)) + c × (r^(w − 1) − 1) ]`
(`specs/enemies.md`), a linear opening/mid ramp (`k`) plus a late-game
exponential surcharge (`c`, `r`) that is `0` at wave 1 and dominates the back third;
all four constants are the difficulty's values from the table. Milestone waves each
carry a Dynamo boss (`specs/enemies.md`): the final wave (`N`) always, and the
midpoint wave (`round(N / 2)`) always (`specs/flow.md`).

- Medium is the reference balance: `50` waves, a gentle base and linear ramp
  (`baseMult = 0.22`, `k = 1.17`) with a moderate late surcharge (`c = 0.28`, `r =
  1.145`): easy early, brutal late.
- Easy runs the shortest, gentlest siege of `40` waves with the lowest base
  (`baseMult = 0.20`), the gentlest ramp (`k = 0.50`), and the smallest surcharge (`c
  = 0.08`, `r = 1.09`), so HP climbs slowly and the run stays forgiving throughout.
- Hard runs the longest, steepest siege of `60` waves with the same opening/mid ramp
  as Medium (`k = 1.30`) but the strongest late surcharge (`c = 0.22`, `r = 1.15`);
  because the surcharge compounds, its final waves climb far past a Medium run's, a
  Wave-`60` total HP pool of a few million. Opening and mid HP differ only modestly
  across difficulty; the dominant difference is the late surcharge and the wave count.

Because the money rate and the `5`-stamp allowance are constant, the extra waves on
Hard simply supply more kill income at the same rate over a longer, tougher campaign;
the difficulty is expressed entirely as more waves of a tougher Load, not a tighter
economy. Wave counts are on the scale of dozens of levels.

The difficulty select menu must let the player read what each difficulty changes, its
wave count and its enemy toughness, before choosing it, and must offer a way back to
the map select menu.
