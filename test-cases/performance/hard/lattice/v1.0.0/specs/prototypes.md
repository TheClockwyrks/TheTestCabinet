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

A belt's `SPEED` — how many position units an unobstructed item advances per tick —
is set by its **`tier`**. A higher tier is a faster belt (the classic 1×/2×/3×
progression), so an upgrade tier is genuinely more throughput, not just cosmetic.

| Tier        | `SPEED` (units/tick) | Ticks to cross a tile |
| ----------- | -------------------- | --------------------- |
| `"slow"`    | `32`                 | `8`                   |
| `"fast"`    | `64`                 | `4`                   |
| `"express"` | `96`                 | `~2.7`                |

Each `SPEED` divides `SPACING` no larger than it, and the compaction clamp `min(pos +
SPEED, ahead + SPACING, head_limit)` (read with the decreasing-`pos` sign convention)
holds an item to standard spacing. **Speed is per tile**: an item advances by the
`SPEED` of the belt tile it currently sits on, so a line of mixed tiers moves items at
mixed rates, and a faster tile behind a slower one cannot shove the item past it.

## Inserter swing

There is exactly **one kind of inserter**, so `SWING` — how many ticks the arm
is held between picking an item up and dropping it — is a single constant, not a
tier table. Every inserter swings at the same rate regardless of where it sits
or which belts it touches, and an inserter entity declares no `tier`.

`SWING` is tied to the **`fast`-tier** belt speed (`64`, the reference rate) so an
item carried in a claw moves at the same linear speed as one on a `fast` belt: an
inserter spans two tiles (it picks from the tile behind and drops on the tile in
front) and a `fast` belt crosses one tile in `TILE / 64` ticks, so `SWING = 2 × TILE /
64 = 512 / 64 = 8`. (An item lifted off a `slow` or `express` belt therefore eases
slightly toward that reference rate while it is in the claw.)

| Constant | Value     |
| -------- | --------- |
| `SWING`  | `8` ticks |

`SWING` is the cost of **each** half of the cycle: the loaded swing out **and** the
empty swing back (see the inserter state machine in `specs/rules.md`) each take
`SWING` ticks, so a full pick-and-place cycle is `2 × SWING` ticks. An inserter
carries exactly **one item per swing**.

## Items and their index order

These are the only item ids v1 uses. The **index** (the position in this list)
is part of the canonical-bytes contract: items are serialized as their `u16`
index, not their string (see `specs/canonical-state.md`). Never assume any other
order.

| Index | Item id                  |
| ----- | ------------------------ |
| `0`   | `iron-ore`               |
| `1`   | `iron-plate`             |
| `2`   | `iron-gear`              |
| `3`   | `copper-ore`             |
| `4`   | `copper-plate`           |
| `5`   | `copper-cable`           |
| `6`   | `circuit`                |
| `7`   | `transport-belt`         |
| `8`   | `fast-transport-belt`    |
| `9`   | `express-transport-belt` |
| `10`  | `assembler`              |
| `11`  | `fast-assembler`         |
| `12`  | `express-assembler`      |
| `13`  | `inserter`               |
| `14`  | `fast-inserter`          |
| `15`  | `express-inserter`       |
| `16`  | `coal`                   |

Indices `7`–`15` are the craftable **machines** — a transport belt, an assembler,
and an inserter, each in three tiers. A factory assembles them from the
intermediates above and ships them to a sink like any other product. v1 ships a
recipe for the tier-1 item of each machine (`transport-belt`, `assembler`,
`inserter`); the six higher-tier ids are reserved so the index order is fixed as
the higher tiers gain recipes.

Index `16`, `coal`, is a **raw material** like the ores — a source emits it and it
rides the belts — but it is the **furnace's fuel**: a furnace consumes one coal per
smelt (see the smelting recipes below), so a furnace with no coal buffered cannot
smelt. It is last in the list because it was added after the machines; the index
order never changes, so every earlier item keeps its number.

## Recipes

Each recipe is a set of input items with counts, a set of output items with
counts, and a `CRAFT` tick cost (ticks from craft start, when the input set is
consumed, to craft finish, when the output set is deposited).

Each recipe is either a **smelting** recipe (marked ✓ below) or not. A smelting
recipe runs **only** on a `furnace`; every other recipe runs **only** on an
`assembler`. This split is a validation rule: an assembler with a smelting recipe,
or a furnace with a non-smelting recipe, is rejected.

| Recipe           | Smelting | Inputs                             | Output              | `CRAFT` (ticks) |
| ---------------- | -------- | ---------------------------------- | ------------------- | --------------- |
| `iron-plate`     | ✓        | `iron-ore` ×1, `coal` ×1           | `iron-plate` ×1     | `32`            |
| `copper-plate`   | ✓        | `copper-ore` ×1, `coal` ×1         | `copper-plate` ×1   | `32`            |
| `iron-gear`      |          | `iron-plate` ×2                    | `iron-gear` ×1      | `64`            |
| `copper-cable`   |          | `copper-plate` ×1                  | `copper-cable` ×2   | `32`            |
| `circuit`        |          | `iron-plate` ×1, `copper-cable` ×3 | `circuit` ×1        | `96`            |
| `transport-belt` |          | `iron-plate` ×1, `iron-gear` ×1    | `transport-belt` ×2 | `48`            |
| `inserter`       |          | `iron-gear` ×1, `circuit` ×1       | `inserter` ×1       | `64`            |
| `assembler`      |          | `transport-belt` ×2, `circuit` ×1  | `assembler` ×1      | `96`            |

The two **smelting** recipes turn a raw ore into a plate by burning one `coal`, and
run on **furnaces**. Because coal is one of the two inputs, a furnace's craft gate
never opens until both the ore **and** a coal are in its input buffer — that is the
fuel rule. The last three recipes are the **machine** recipes and form a dependency
tree: a `transport-belt` and an `inserter` are built from the base intermediates (a
belt from plate and a gear; an inserter from a gear and a circuit), and an
`assembler` is built from a **machine** — two `transport-belt`s — plus a circuit. So
a factory that builds assemblers must route belts _forward into_ the assembler stage
rather than straight to a sink. Every `CRAFT` cost divides `LCM(32, 64, 96) = 192`,
so the whole factory keeps a single short steady-state cycle.

## Crafter buffer caps

Both crafting machines — the `assembler` and the `furnace` — share these buffer
caps:

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
- A **furnace** anchored at `(x, y)` occupies a **2×2 block**, covering
  `(x..x+2, y..y+2)` — i.e. `(x, y)` through `(x+1, y+1)`. Like the assembler it is
  non-directional (it carries no `dir`), and inserters interact with it from any
  tile adjacent to that footprint.
