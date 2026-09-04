# Orrery — The field, motes, and filaments

This file defines the hex field every machine is built on: the coordinate
system, the geometry that places a hex on the stage, the motes that move across
it, and the filaments that join motes into constellations. The parts a machine
is built from are in `specs/parts.md`, the sigils that transform motes are in
`specs/sigils.md`, and the simulation that moves everything is in
`specs/simulation.md`. Every figure below carries the name this specification
gives it.

## Hexes and axial coordinates

The field is a grid of pointy-top hexes addressed by axial coordinates
`(q, r)`. The center of hex `(q, r)` on the stage is:

- `hexX(q, r) = FIELD_CX + HEX_PITCH * (q + r / 2)`
- `hexY(q, r) = FIELD_CY + HEX_PITCH * (sqrt(3) / 2) * r`

| Constant | Value | Meaning |
| --- | --- | --- |
| `FIELD_CX` | `616` | Stage `x` of hex `(0, 0)`. |
| `FIELD_CY` | `304` | Stage `y` of hex `(0, 0)`. |
| `HEX_PITCH` | `48` | Distance between adjacent hex centers. |
| `FIELD_R` | `5` | Radius of the field, in hexes. |
| `HEX_HIT_R` | `26` | Pointer targeting radius around a hex center. |

The field is the hexagonal region of radius `FIELD_R` around `(0, 0)`: hex
`(q, r)` is on the field exactly when `max(|q|, |r|, |q + r|) <= FIELD_R`. That
is `91` hexes, spanning stage `x` `376` to `856` and `y` `96.15` to `511.85`
from center to center.

## Directions and rotation

`DIRS` holds the six neighbor offsets, indexed `0` to `5`, in clockwise order
on the stage starting from east:

| Index | Offset `(dq, dr)` | Toward |
| --- | --- | --- |
| `0` | `(+1, 0)` | East |
| `1` | `(0, +1)` | Southeast |
| `2` | `(-1, +1)` | Southwest |
| `3` | `(-1, 0)` | West |
| `4` | `(0, -1)` | Northwest |
| `5` | `(+1, -1)` | Northeast |

Two hexes are adjacent when their difference is one of `DIRS`.

Rotating an offset `(q, r)` by one 60 degree step about `(0, 0)`:

- Clockwise: `(q, r) -> (-r, q + r)`
- Counterclockwise: `(q, r) -> (q + r, -q)`

Rotating about an arbitrary hex applies the same formula to the offset from
that hex. Rotating a direction index clockwise adds `1` modulo `6`;
counterclockwise subtracts `1`. Every rotating part in `specs/simulation.md`
moves by these formulas.

## Targeting a hex

The pointer targets the field hex whose center is nearest to the pointer
position, provided that distance is at most `HEX_HIT_R` (`26`). When two or
more centers are equidistant, the hex with the smaller `r` wins, then the
smaller `q`.

## Motes

A mote is one celestial body resting on a hex or carried through the air by an
arm. At rest a mote sits exactly on a hex center, and at most one mote occupies
a hex. `MOTES` names the fifteen types:

| Type | Class | What it is |
| --- | --- | --- |
| `dust` | base | Inert stardust. |
| `nebula` | essence | The essence of cloud. |
| `comet` | essence | The essence of ice. |
| `nova` | essence | The essence of fire. |
| `meteor` | essence | The essence of stone. |
| `mercury` | catalyst | Spent to raise a planet one rung. |
| `saturn` | planet | The first rung of the planetary ladder. |
| `jupiter` | planet | The second rung. |
| `mars` | planet | The third rung. |
| `venus` | planet | The fourth rung. |
| `luna` | planet | The fifth rung. |
| `sol` | planet | The sixth and final rung. |
| `umbra` | polarity | Condensed shadow. |
| `lumen` | polarity | Condensed light. |
| `aether` | quintessence | The union of all four essences. |

`ESSENCES` holds `nebula`, `comet`, `nova`, `meteor` in that order. `PLANETS`
holds the ladder `saturn`, `jupiter`, `mars`, `venus`, `luna`, `sol` in that
order; ascending a planet moves it one rung toward `sol`, which is the top
rung. Which sigils transmute which types is defined in `specs/sigils.md`.

Two radii govern a mote:

| Constant | Value | Governs |
| --- | --- | --- |
| `MOTE_R` | `22` | Every mote's drawn form fits inside this radius of its position. |
| `MOTE_COLLIDE_R` | `19` | Collision radius. Two motes collide when their centers come closer than `2 * MOTE_COLLIDE_R` (`38`), as `specs/simulation.md` defines. |

A fixture is one of the six motes a zodiac wheel carries, defined in
`specs/parts.md`. A fixture collides as a mote does, and `specs/sigils.md`
states how a sigil reads a hex a fixture rests on.

## Filaments and constellations

A filament is a rigid link between two motes on adjacent hexes. It carries a
`weight` of `1` or `3`; a weight of `3` is a triune filament, created only as
`specs/sigils.md` describes. At most one filament joins a given pair of motes.

A constellation is a maximal group of motes connected by filaments. A lone mote
with no filaments is a constellation of one. Constellations are rigid: when any
mote of one is carried, the whole group moves as a body and every filament
keeps its length and relative direction. Grabbing, carrying, and the rule for a
group held more than once are defined in `specs/simulation.md`.

## Molecule patterns

Reagents and products are written as molecule patterns: a set of motes on
relative hex coordinates plus the filaments between them. The JSON form is
defined in `specs/formats.md`. A pattern is placed onto the field at an anchor
hex and a rotation `0` to `5`: each pattern coordinate is rotated about
`(0, 0)` by the rotation, using the formulas above, then translated by the
anchor. Filament endpoints rotate the same way.

## Presentation

The mote and filament art is produced during this build, as `specs/assets.md`
states. What the look must deliver:

1. Every one of the fifteen mote types is identifiable at a glance, and the six
   planets read in the ladder order of `PLANETS`.
2. A filament visibly joins the centers of the two motes it links, and a triune
   filament reads as clearly heavier than a plain one.
3. A fixture reads as part of its wheel rather than as a loose mote.
4. Every mote's drawn form fits inside `MOTE_R` (`22`) of its position.
5. The field's hexes are visible enough to place parts by.
