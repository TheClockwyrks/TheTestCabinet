# Orrery — Sigils

This file defines every sigil's footprint and effect. A sigil is engraved on
the field: it never moves, and once per cycle, in the sigil phase
`specs/simulation.md` defines, it acts on the motes resting on its hexes.
Footprints are written as relative hexes at rotation `0`; a placed sigil's
hexes are its footprint rotated and translated as `specs/field.md` describes.
The placement rules and costs are in `specs/parts.md`.

Terms used below, for a mote at rest on a sigil hex:

- unbonded: the mote carries no filament.
- unheld: no gripper holds any mote of the mote's constellation.
- vacant: the hex holds no mote at all.
- Fixtures are ignored: a fixture never satisfies a condition, with the one
  exception named under Mirroring, and a hex holding a fixture is not vacant.

A sigil whose condition does not hold this cycle does nothing this cycle.
Waiting is not a fault.

## Binding sigils

### `bind`

| Hex | Role |
| --- | --- |
| `(0, 0)` | first |
| `(1, 0)` | second |

When both hexes hold motes and no filament joins that pair, a filament of
weight `1` is created between them. Held motes bind like any others, and
binding two constellations merges them into one. A pair already joined, by
either weight, is left as it is.

### `manifold`

| Hex | Role |
| --- | --- |
| `(0, 0)` | center |
| `(1, 0)` | reach |
| `(-1, +1)` | reach |
| `(0, -1)` | reach |

When the center holds a mote, each reach hex that also holds a mote is bound
to the center exactly as `bind` binds a pair: a weight `1` filament where none
joins them yet. Up to three filaments are created in one cycle. An empty
center means nothing happens.

### `triune`

| Hex | Role |
| --- | --- |
| `(0, 0)` | first |
| `(1, 0)` | second |

When both hexes hold `nova` motes and no filament joins that pair, a filament
of weight `3` is created between them. Any other pair of types, and any pair
already joined, is left as it is.

## Sundering

### `sunder`

| Hex | Role |
| --- | --- |
| `(0, 0)` | first |
| `(1, 0)` | second |

When a filament joins the motes on its two hexes, that filament is removed,
whatever its weight. A constellation split by the removal becomes two.

## Transmuting sigils

### `wane`

| Hex | Role |
| --- | --- |
| `(0, 0)` | seat |

An essence mote on the seat becomes `dust`. Its filaments, its constellation,
and any hold on it are untouched. Every other type is left as it is.

### `mirror`

| Hex | Role |
| --- | --- |
| `(0, 0)` | source |
| `(1, 0)` | target |

When the source holds an essence and the target holds `dust`, the target
becomes that essence. The source is the one condition in this game a fixture
satisfies: a wheel's essence fixture on the source hex mirrors exactly as a
loose essence does. The target must be a real mote; nothing is ever written
onto a fixture.

### `ascend`

| Hex | Role |
| --- | --- |
| `(0, 0)` | prime |
| `(1, 0)` | crown |

When the prime holds an unbonded, unheld `mercury` and the crown holds a
planet below `sol`, the `mercury` is consumed and the planet rises one rung of
`PLANETS`. The planet may be bonded and held. A `sol` on the crown leaves the
`mercury` unspent.

### `conjoin`

| Hex | Role |
| --- | --- |
| `(0, 0)` | fount |
| `(1, 0)` | fount |
| `(0, 1)` | crown |

When both founts hold unbonded, unheld motes of the same planet below `sol`
and the crown is vacant, both are consumed and one mote of the next rung
appears on the crown, unbonded and unheld.

### `eclipse`

| Hex | Role |
| --- | --- |
| `(0, 0)` | fount |
| `(1, 0)` | fount |
| `(0, 1)` | umbral crown |
| `(1, -1)` | lumen crown |

When both founts hold unbonded, unheld `dust` and both crowns are vacant, both
`dust` are consumed, an `umbra` appears on the umbral crown, and a `lumen`
appears on the lumen crown, each unbonded and unheld.

### `confluence`

| Hex | Role |
| --- | --- |
| `(0, 0)` | crown |
| `(1, 0)` | fount |
| `(0, 1)` | fount |
| `(-1, 0)` | fount |
| `(0, -1)` | fount |

When the four founts hold unbonded, unheld motes comprising one of each
essence, in any arrangement, and the crown is vacant, all four are consumed
and one `aether` appears on the crown, unbonded and unheld.

### `dispersion`

| Hex | Role |
| --- | --- |
| `(0, 0)` | fount |
| `(1, 0)` | nebula crown |
| `(0, 1)` | comet crown |
| `(-1, 0)` | nova crown |
| `(0, -1)` | meteor crown |

When the fount holds an unbonded, unheld `aether` and all four crowns are
vacant, the `aether` is consumed and the four essences appear, each on its
named crown, unbonded and unheld.

## The void

### `void`

| Hex | Role |
| --- | --- |
| `(0, 0)` | maw |
| all six neighbors of `(0, 0)` | rim |

An unbonded, unheld mote on the maw is consumed. The rim consumes nothing; it
exists so the void claims its clearing on the field through the placement
rules in `specs/parts.md`.

## Rises and sets

### `rise`

A rise's footprint is its reagent pattern placed at the rise's pose. When
every footprint hex is vacant, the reagent appears: one new mote per pattern
mote and one filament per pattern filament, at the placed pose, unheld. A rise
whose footprint is even partly occupied waits.

### `set`

A set's footprint is its product pattern placed at the set's pose; when the
product repeats, the footprint also includes the pattern translated once by
the placed repeat vector. A set watches for its product:

- For a plain product, a constellation is accepted when it is unheld and is
  exactly the placed pattern: one mote of the pattern's type on each pattern
  hex, one filament of the pattern's weight for each pattern filament, and no
  further mote or filament in the constellation.
- For a repeating product, a constellation is accepted when it is unheld and
  is exactly `k` chained copies of the pattern, `k >= REPEAT_MIN` (`2`): copy
  `i` is the pattern translated by `i` times the placed repeat vector for `i`
  from `0` to `k - 1`, consecutive copies are joined by the placed link
  filament and its translates, and the constellation holds nothing further.

An accepted constellation is consumed whole, and the set's tally rises by `1`
for a plain product and by `k` for a repeating one. The tallies decide
completion, as `specs/simulation.md` defines.
