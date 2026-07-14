# Modes

## Overview

This file defines the **difficulty** a player chooses before a run, and the two
menus that lead into it: the **map select** and the **difficulty select**. It
builds on the board and the three maps in `specs/board.md`, the Load and its
per-wave HP scaling in `specs/enemies.md`, and the economy, campaign, and
win/lose states in `specs/flow.md`.

There is exactly **one campaign** (`SALVAGE`) and **no special modes** — every
run plays the same campaign, roster, economy, and build loop. Difficulty changes
**only** the number of waves and how tough the Load grows; nothing else is
overridden. The tile floor, the ordered-waypoint mazing and live re-pathing, the
scrap-press build, the keep / slag / combine loop and the quality ladder, the
five components, the economy, and Grid Integrity all work exactly as their specs
define them, at every difficulty.

The numeric values in this file are **fixed**; implement them exactly as written.
The **wording** of the on-screen descriptions and the **layout** of the menus are
yours (see `specs/flow.md`, Required menus): what is required is that the content
and navigation below are present.

## The menu flow

The title menu's play action is a single **SALVAGE** entry (followed by
`HOW TO PLAY`; see Game states in `specs/flow.md`). Choosing it does not start a
game directly — it opens the **map select** menu. From there:

- Choosing one of the three maps (`specs/board.md`) opens the **difficulty
  select** menu.
- Choosing a difficulty starts a run on the selected map at that difficulty.

Both menus are defined as states in `specs/flow.md` (Game states, Required
menus). This file supplies their **content**: the maps and difficulties listed
below, and the information each must show about itself.

## Map select

The map select menu lists the three maps of `specs/board.md` — **The
Substation** (the original waypoint layout), **The Switchyard** (different
waypoint locations), and **The Transformer Yard** (different waypoints plus two
fixed transformer housings that pre-shape the maze). Each map plays the same
campaign, economy, roster, and scaling; only the topology — the waypoint chain
and any fixed housings — differs.

The menu must show each map so the player can tell them apart before choosing (a
small preview of the waypoint layout is welcome), and must offer a way back to
the title menu.

## Difficulty select

A run is played at one of three **difficulties**, chosen on the difficulty select
menu. A difficulty sets **only** the **number of waves** and the **enemy
toughness** — the per-wave HP-scaling constants `baseMult` and `k`
(`specs/enemies.md`). **Every other value is identical across difficulty:**
starting Charge (`130`), Grid Integrity (`20`), builds-per-level (`5`), the stamp
cost (`18`), the Load roster, the economy, and the components are all unchanged.
Only the wave count and the HP scaling move.

| Difficulty | Waves `N` | HP base multiplier `baseMult` | HP scaling `k` | Milestone waves |
| --- | --- | --- | --- | --- |
| **Easy** | `20` | `0.85` | `0.15` | `10`, `20` |
| **Medium** | `30` | `1.00` | `0.20` | `15`, `30` |
| **Hard** | `40` | `1.15` | `0.26` | `20`, `40` |

A unit's HP on wave `w` is `baseHP × baseMult × (1 + k × (w − 1))`
(`specs/enemies.md`); `baseMult` and `k` are the difficulty's values from the
table. **Milestone waves** each carry a **Dynamo** boss (`specs/enemies.md`): the
final wave (`N`) always, and the midpoint wave (`round(N / 2)`) always
(`specs/flow.md`).

- **Medium** is the reference balance — `30` waves, unscaled base HP
  (`baseMult = 1.0`), and the standard per-wave HP ramp (`k = 0.20`).
- **Easy** runs a shorter siege of `20` waves with a lower base HP and a gentler
  per-wave ramp.
- **Hard** runs a longer siege of `40` waves with a higher base HP and a steeper
  ramp; because HP scales per wave, its later waves climb far past a Medium run's.

Because the money rate and the `5`-stamp allowance are constant, the extra waves
on Hard simply supply more kill income at the same rate over a longer, tougher
campaign — the difficulty is expressed entirely as more waves of a tougher Load,
not a tighter economy. Wave counts are on the scale of dozens of levels.

The difficulty select menu must let the player read what each difficulty changes
— its **wave count** and its **enemy toughness** — before choosing it, and must
offer a way back to the map select menu.
