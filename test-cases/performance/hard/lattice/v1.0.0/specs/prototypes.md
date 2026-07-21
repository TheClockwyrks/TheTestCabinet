# Prototype table

These are the fixed constants of the Lattice world. A scenario _refers_ to
prototypes by name (`"tier": "fast"`, `"recipe": "iron-gear"`,
`"item": "iron-plate"`); it never redefines them. Your engine must use these
exact integers — they are part of the contract, and the reference engine the
harness runs you against reads the same table. **Everything here is an
integer.** There is no floating-point arithmetic anywhere in the model; that is
what makes the state after _N_ ticks a single bit-exact value.

## Geometry

| Constant  | Value | Meaning                                                                                                                       |
| --------- | ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| `TILE`    | `256` | Position units per tile of lane length (a power of two).                                                                      |
| `SPACING` | `64`  | Minimum centre-to-centre distance between two items on the same lane (`= TILE / 4`, so at most four items per tile per lane). |

An item's position on a lane is a single integer in `0..TILE`, measured **from
the lane's output end** — the downstream edge of the tile, in the belt's
direction of travel. Because position is measured from the output end,
**"forward" decreases `pos`**: an item at `pos = 0` sits exactly at the output
edge, an item at `pos = 255` is at the back of the tile.

## Belt speed

Every transport belt moves at **one uniform `SPEED`**: how many position units an
unobstructed item advances per tick.

| Constant | Value             |
| -------- | ----------------- |
| `SPEED`  | `64` (units/tick) |

`SPEED` divides `SPACING` cleanly, and the compaction clamp `min(pos + SPEED,
ahead + SPACING, head_limit)` (read with the decreasing-`pos` sign convention)
holds an item to standard spacing. A belt entity's `tier` (`"slow"`, `"fast"`,
`"express"`) is accepted for compatibility but is **cosmetic**: all three resolve
to the same `SPEED`, so every belt in a scenario moves at one rate.

## Inserter swing

There is exactly **one kind of inserter**, so `SWING` — how many ticks the arm
is held between picking an item up and dropping it — is a single constant, not a
tier table. Every inserter swings at the same rate regardless of where it sits
or which belts it touches, and an inserter entity declares no `tier`.

`SWING` is tied to the belt `SPEED` so an item moves at the **same linear speed**
whether it rides a belt or is carried by an inserter: an inserter spans two tiles
(it picks from the tile behind and drops on the tile in front) and a belt crosses
one tile in `TILE / SPEED` ticks, so `SWING = 2 × TILE / SPEED = 512 / 64 = 8`.

| Constant | Value     |
| -------- | --------- |
| `SWING`  | `8` ticks |

An inserter carries exactly **one item per swing**.

## Items and their index order

These are the only item ids v1 uses. The **index** (the position in this list)
is part of the canonical-bytes contract: items are serialized as their `u16`
index, not their string (see `specs/canonical-state.md`). Never assume any other
order.

| Index | Item id        |
| ----- | -------------- |
| `0`   | `iron-ore`     |
| `1`   | `iron-plate`   |
| `2`   | `iron-gear`    |
| `3`   | `copper-ore`   |
| `4`   | `copper-plate` |
| `5`   | `copper-cable` |
| `6`   | `circuit`      |

## Recipes

Each recipe is a set of input items with counts, a set of output items with
counts, and a `CRAFT` tick cost (ticks from craft start, when the input set is
consumed, to craft finish, when the output set is deposited).

| Recipe         | Inputs                             | Output            | `CRAFT` (ticks) |
| -------------- | ---------------------------------- | ----------------- | --------------- |
| `iron-plate`   | `iron-ore` ×1                      | `iron-plate` ×1   | `32`            |
| `copper-plate` | `copper-ore` ×1                    | `copper-plate` ×1 | `32`            |
| `iron-gear`    | `iron-plate` ×2                    | `iron-gear` ×1    | `64`            |
| `copper-cable` | `copper-plate` ×1                  | `copper-cable` ×2 | `32`            |
| `circuit`      | `iron-plate` ×1, `copper-cable` ×3 | `circuit` ×1      | `96`            |

## Assembler buffer caps

| Constant     | Value | Meaning                                                             |
| ------------ | ----- | ------------------------------------------------------------------- |
| `INPUT_CAP`  | `8`   | Maximum count of each distinct input item the input buffer holds.   |
| `OUTPUT_CAP` | `8`   | Maximum count of each distinct output item the output buffer holds. |

## Directions and lanes

The grid is `x` rightward and `y` downward: **`E` = `+x`, `W` = `-x`, `S` =
`+y`, `N` = `-y`**. The canonical orientation in any reference material is
**flow-east**.

A belt has two independent lanes, **left** and **right** relative to the belt's
direction of travel. The left lane is 90° counter-clockwise of travel:

| Belt facing | Left lane is on the … side | Right lane is on the … side |
| ----------- | -------------------------- | --------------------------- |
| `E` (`+x`)  | `-y` (north)               | `+y` (south)                |
| `W` (`-x`)  | `+y` (south)               | `-y` (north)                |
| `N` (`-y`)  | `-x` (west)                | `+x` (east)                 |
| `S` (`+y`)  | `+x` (east)                | `-x` (west)                 |

A source's `lane` selector (`left` / `right` / `both`) names the **downstream
belt's own** lanes by this convention; `both` acts on left then right
independently.

## Multi-tile footprints

- A **splitter** anchored at `(x, y)` facing `dir` occupies two tiles: the
  anchor and one tile **one step perpendicular-clockwise** of `dir`. For an `E`-
  or `W`-facing splitter the second tile is `(x, y + 1)`; for an `N`- or
  `S`-facing splitter it is `(x + 1, y)`.
- An **assembler** anchored at `(x, y)` occupies a **3×3 block**, covering
  `(x..x+3, y..y+3)` — i.e. `(x, y)` through `(x+2, y+2)`. Inserters interact
  with it from any tile adjacent to that footprint.
