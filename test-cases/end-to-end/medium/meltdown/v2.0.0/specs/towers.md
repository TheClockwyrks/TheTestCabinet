# Meltdown — The tower roster

Eight towers stand on the floor: six emitters that fire, and the Forge and the
Sink, which never fire and only move heat. This file gives them as data. What an
emitter does to a surge unit is in `specs/combat.md`, what the heat figures mean
is in `specs/heat.md`, and what a player does to a tower is in
`specs/building.md`.

## Footprints and rotation

A tower occupies a square footprint of 2x2, 3x3, or 4x4 tiles, anchored and
measured as `specs/floor.md` states. Range is measured from the footprint's
centre.

Each emitter designates some of its faces as radiator faces, which shed heat far
better than a plain face. Radiator faces are given below in the tower's local
orientation, which is its orientation at rotation `0`.

A tower carries a placement rotation of `0`, `1`, `2`, or `3`, each a further
90-degree step, chosen while the tower is held and fixed the moment it is placed.
The rotation turns the local faces into world faces in the order
`N -> E -> S -> W`, so rotation `1` turns a local `N` into a world `E`, rotation
`2` into a world `S`, and rotation `3` into a world `W`. A tower's radiator faces
are reported and drawn in world orientation.

A footprint's size and shape are the same at every rotation.

## The emitters

| Tower | Size | Cost | Range | Fire rate | Base damage | `heatPerShot` | Redline | Mass | Radiators (local) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Arc | 2 | 15 | 6.0 | 2.0 | 6 | 10.3 | 80 | 1.0 | N, S |
| Stutter | 2 | 40 | 5.0 | 7.0 | 2.0 | 4.2 | 60 | 0.5 | N, E |
| Rime | 2 | 45 | 5.5 | 2.4 | 4 | 7.0 | 100 | 1.1 | N, S, E |
| Flak | 2 | 60 | 8.0 | 2.6 | 6 | 9.6 | 78 | 0.9 | N, S |
| Bloom | 3 | 150 | 6.0 | 1.2 | 10 | 27.3 | 82 | 1.8 | N, E |
| Lance | 4 | 150 | 12.0 | 0.8 | 43 | 48.9 | 92 | 2.8 | N, E |

Size is the footprint's side in tiles, cost is in money, range is a radius in
tiles, fire rate is shots per second, and `heatPerShot` is the heat one shot adds
before mass divides it. An upgrade moves four of these figures and no others,
under Levels below: range, fire rate, base damage, and `heatPerShot`. Those four
are given at level I. Size, cost, redline, and mass are the same at every level.

## The Forge and the Sink

Both are 2x2, cost `20`, never fire, carry no heat, and have no radiator faces at
any rotation. They do not rotate. Both block their four tiles like any other
tower.

| Tower | What it does to each emitter it touches | Level I | Level II | Level III |
| --- | --- | --- | --- | --- |
| Forge | Warms it toward the setpoint, and never past it (`FORGE_SETPOINT`) | 72 | 84 | 96 |
| Sink | Drains it, per shared edge-tile, proportional to its heat (`SINK_OUTPUT`) | 16 | 24 | 36 |

`specs/heat.md` gives the flow each one drives.

## Levels

Every tower runs at level `1`, `2`, or `3`, and `MAX_LEVEL` is `3`. Level `1` is
what a placed tower starts at.

Each level above the first applies the following to an emitter, once per level:

| Figure | Constant | Effect per level |
| --- | --- | --- |
| Base damage | `UPGRADE_DAMAGE` | multiplied by `1.6` |
| Range | `UPGRADE_RANGE` | `1.0` tile added |
| Fire rate | `UPGRADE_FIRE_RATE` | multiplied by `1.15` |
| `heatPerShot` | `UPGRADE_HEAT` | multiplied by `1.3` |

So a level III emitter carries `1.6^2` times its base damage, `2.0` tiles more
range, `1.15^2` times its fire rate, and `1.3^2` times its `heatPerShot`.

A level leaves the footprint's size, the redline, the mass, and the radiator face
layout exactly as they were.

The Rime's cold-slow ceiling `RIME_SLOW_CEIL` is `0.55` at level I, `0.68` at
level II, and `0.80` at level III, alongside the four figures above.

A mover's level moves its own output alone, as the table above gives it.
