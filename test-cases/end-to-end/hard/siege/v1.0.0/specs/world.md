# Siege — The world: arena, terrain, and redoubts

This file defines the battlefield: its extent, the procedurally generated
terrain, the three redoubts you defend, where the Scourge enters, and where you
respawn. Coordinates and sizes are **world units** on the axes from
`specs/overview.md` (`+X` = the advance/retreat axis, low `X` is the Scourge home
edge; `+Y` = up; `Z` = width). The survival loop that plays out on this world is
in `specs/phases.md`; the units that fight over it are in `specs/combat.md` and
`specs/ai.md`.

## The arena

The playable world is a fixed axis-aligned box of voxels:

- **Length (`X`): 512.** The Scourge attacks from the low-`X` edge; the defense
  falls back toward the high-`X` edge.
- **Width (`Z`): 128.** The full width is playable; the north and south edges
  (`Z = 0` and `Z = 128`) are hard boundaries.
- **Height (`Y`): 64.** Terrain occupies the lower part; the space above is open
  air for artillery arcs, jumps, and the sky. Nothing may leave the box.

The four vertical sides and the floor are **solid, impassable boundaries** — no
unit, projectile, or the player may pass out of the box. Terrain never exceeds
`Y = 64`.

The length and width above are the values to build to, and everything downstream
(redoubt positions, spawn lines) is given relative to them. Height stays `64`.

## Terrain — procedurally generated, non-destructible

You must **procedurally generate** the terrain each match. There is deliberately
**little steering** here: the quality of the world you invent — how natural,
varied, and playable it is — is part of what matters here. Requirements:

- The terrain is a solid voxel landform: a heightfield of grass over dirt over
  rock is the baseline, and you may add variety (hills, ridges, plateaus, gullies,
  scattered rock or cover) as long as the result reads as a coherent natural
  frontier, not random noise or a flat plane.
- **Varied but traversable elevation.** There must be real elevation change —
  meaningful high ground and low ground — but the terrain between the Scourge
  spawn edge and each redoubt must be **navigable on foot** by walking and short
  climbs/jumps; do not generate impassable walls, sheer unclimbable cliffs across
  the whole width, or floating voxels disconnected from the ground.
- **No holes or floating islands.** The landform is watertight to the floor: no
  gaps a unit falls through, no chunks hanging in the air.
- **Non-destructible.** Terrain does not change during a match. Weapons, grenades,
  artillery, and deaths do **not** carve, crater, or add voxels — they affect
  units and structures only. Pathfinding may therefore treat the terrain as static
  (`specs/ai.md`).
- The terrain is drawn in the terrain palette from `specs/overview.md` (grass top,
  dirt and rock beneath, sand/path where a route is worn), and must hold the frame
  rate the rendering requirements set (`specs/overview.md`).

## The redoubts

Three Warden redoubts stand in a line along the retreat axis. Each is a
**procedurally placed fortification** — a compact concrete-gray blockwork
strongpoint (walls, a raised firing platform, a blue Warden banner) large enough
to fight around, roughly `16`–`24` units across. You generate their exact form,
but each must:

- **Sit correctly on the generated terrain** — founded on the ground with no
  floating base and nothing buried to the parapet. Level or step the terrain
  under a redoubt as needed so it reads as built, not dropped.
- Be **approachable on foot from the Scourge (low-`X`) side** — a reachable
  route/entrance the attackers can path to, so the assault can actually reach it.
- Have a defensible interior/platform a player and squad can hold and fire from.

The three redoubts sit at these positions along `X`, centered on the width
(`Z ≈ 64`), each on whatever terrain height it lands on:

| Redoubt | Position (`X`) | Health (HP) |
| --- | --- | --- |
| **A** (forward) | `≈ 160` | `1500` |
| **B** (middle) | `≈ 300` | `2000` |
| **C** (last stand) | `≈ 440` | `2500` |

A short **defender's back wall** closes the arena just behind C at `X = 512`.

Each redoubt has a **health pool** (above). It is the objective the Scourge is
trying to destroy: attackers deal damage to the **currently active** redoubt (how,
and why it always eventually falls, is in `specs/phases.md`). A redoubt's health
**does not regenerate**. Only the active redoubt takes damage; redoubts you have
not fallen back to yet are inert, and a redoubt that has fallen is captured Scourge
ground.

## Enemy spawn lines

The Scourge enters at a **spawn line** — a band across the full width (`Z`) at a
fixed `X`, on the terrain surface. The spawn line **advances** each time a redoubt
falls, so attackers never trickle in from impossibly far back once you have given
ground:

| Active phase | Defending | Scourge spawn line (`X`) |
| --- | --- | --- |
| A | Redoubt A | `≈ 24` |
| B | Redoubt B | `≈ 160` (the fallen A line) |
| C | Redoubt C | `≈ 300` (the fallen B line) |

Attackers spawn along this line spread across the width, then advance and path
toward their target (`specs/ai.md`). Spawning is out of the player's direct sight
where the terrain allows, but need not be perfectly hidden.

## Where you and your squad respawn

You respawn (`specs/phases.md`) and your squad respawns (`specs/ai.md`) **behind
the currently active redoubt**, toward the back wall, so you re-enter the fight
near the objective but not on top of the attackers:

- **Player respawn point:** `≈ 48` units behind the active redoubt (toward high
  `X`) — `X ≈ 208` while defending A, `≈ 348` for B, `≈ 488` for C — on the
  terrain surface, facing the Scourge.
- **Squad respawn point:** near the same location (`specs/ai.md`).

When you start a siege directly at phase B or C (via **PLAY** on the title screen;
`specs/phases.md`), the redoubts forward of your start are already fallen and the
spawn line and respawn points are set to that phase from the first second.
