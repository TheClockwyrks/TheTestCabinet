# The simulation rules

Lattice is a deterministic factory simulation. A **scenario** is a static
factory layout — entities placed once on a tile grid at tick 0 — plus "run it
for _N_ ticks." There is no player and no construction during a run: only the
items moving through the layout change. Your engine's job is to compute the
factory's exact state at each scheduled snapshot tick.

This document is the **complete and authoritative** definition of how every
entity behaves and the exact order each tick runs in. Nothing about an entity's
behavior is left to infer from the training examples — Lattice is a
_reimplement-this-exactly_ problem. The fixed constants (`TILE`, `SPACING`,
belt tiers, the inserter swing, recipes, buffer caps, the direction/lane
convention, the
multi-tile footprints) live in `specs/prototypes.md`; this document references
them by name.

## The world

A scenario plays out on a fixed tile grid; each tile holds at most one entity.
Everything is integer / fixed-point — item positions, belt speeds, swing timers,
craft progress — so the state after _N_ ticks is a single well-defined value.
The six entity kinds are:

- **Belt** — moves items in a direction, with two independent lanes.
- **Splitter** — balances items across two belts in and two belts out, evenly
  over all four output lanes.
- **Inserter** — swings a single item from the tile behind it onto the tile in
  front.
- **Assembler** — consumes input items and crafts an output to a recipe.
- **Source** — a test fixture that emits a fixed item onto a belt at a fixed
  cadence.
- **Sink** — a test fixture that consumes and counts whatever reaches it.

Sources and sinks are the **measurement fixtures**: the deterministic way items
enter the factory and the place their throughput is read.

## The two-lane belt model

A belt occupies one tile, faces one of `N`/`S`/`E`/`W`, and carries items in
that direction. Every belt has a **left** and a **right** lane (relative to
travel; see the lane convention in `specs/prototypes.md`), and the two lanes are
**fully independent** 1-D tracks. An item lives on exactly one lane and never
changes lanes on a straight belt. A belt's tier sets its `SPEED`.

### The fixed-point item model

Within a lane, an item's position `pos` is a single integer in `0..TILE`, its
distance from the lane's **output end** (the downstream edge). Position
decreases toward the output: `pos = 0` is exactly at the output edge. Two items
on the same lane may never be closer than `SPACING`.

A lane's items are kept in **ascending `pos`** order — the lead item (smallest
`pos`, closest to the output) first.

### Movement and compaction

Each tick, each lane is advanced by walking its items **from the output end
backward** (lead item first) and moving each one as far forward as it can go.
Writing the clamp with the decreasing-`pos` convention:

```
new_pos = max(pos - SPEED,            // its own speed (forward = decreasing pos)
              ahead_pos + SPACING)    // never closer than SPACING to the item ahead
```

- The **lead item** (no item ahead of it) clamps only against the output edge:
  `new_pos = max(pos - SPEED, 0)`.
- Every following item clamps against the item ahead of it **after that item has
  already moved this tick** (you walk lead-first), so
  `new_pos = max(pos - SPEED, ahead_new_pos + SPACING)`.

Two consequences fall straight out, and they are the entire compaction story:

- A gap **larger** than `SPACING` shrinks by up to `SPEED` each tick as the
  trailing item rolls forward, until it closes to exactly `SPACING`. Belt
  movement **compresses** a stream toward standard spacing on its own.
- Belt movement **can never create** a gap smaller than `SPACING`, and once a
  run of items is packed at `SPACING` it moves forward as a rigid block. _Once a
  belt compresses, it stays that way_ — and that is exactly the property an
  efficient engine exploits (see `specs/contract.md` and the overview).

A gap **smaller** than `SPACING` can only ever appear when something **forces**
an item in at a non-standard coordinate — an inserter dropping, a source
emitting, or a belt **side-loading** into a lane whose items are not on the
standard grid.

### Forcing an item onto a lane

An item may be forced into a gap of **at least `SPACING`**: it may land closer
than standard spacing to its new neighbours, and the next time the belt moves
the gap re-expands to standard. A gap **smaller** than `SPACING` cannot accept a
forced item — the inserter or source **stalls** and holds its item until room
opens.

Concretely, a forced item lands at a target position `pos` on a lane iff
**both** neighbors (the nearest item with a smaller `pos` and the nearest with a
larger `pos`, if any) are at least `SPACING` away — and there is no item exactly
at `pos`. Otherwise the force fails and the item is not placed this tick.

Note the bound is `>= SPACING`, not `> SPACING`. The standard entry coordinate
is `TILE - SPACING`, and on a lane already compacted to standard spacing the
item ahead of that slot sits at `TILE - 2 * SPACING` — exactly `SPACING` away. A
strict bound would refuse every such force, so the last slot of each tile could
never be filled and a "full" belt would run at three items per tile with a
permanent gap. The inclusive bound is what lets a belt actually saturate at four
items per tile per lane.

- A **source** and an **inserter dropping onto a belt** force at the belt's
  **input end**, at the standard entry coordinate `pos = TILE - SPACING` (one
  standard spacing inside the input edge). The force lands iff that slot's
  neighbors are at least `SPACING` away.

### Belt-to-belt feeding

A belt hands its lead item to the belt one tile ahead in its facing **when that
item has reached the output edge** (`pos == 0`). The item is removed from this
belt and reattached on the downstream belt one full tile back from _its_ output
end, at the arrival coordinate `pos = TILE - SPACING`, **iff the downstream lane
can accept it under the forcing rule** above; otherwise it stays put and the
lane behind it stays blocked.

- **End-feeding** (the two belts are collinear, same facing): each lane flows
  into the **same** lane of the downstream belt (left → left, right → right).
- **Curves** (the downstream belt faces a perpendicular direction): the lanes
  remap **equal-length** in the base ruleset — the physical (outer/inner) side
  is carried across the turn, so the lane on a given physical side stays on that
  side. (Factorio's realistic inner-lane-shorter curve geometry is a future
  variant; in v1 both lanes are equal length through a curve.)
- **Side-loading** is the same hand-off seen from the target: when a belt faces
  into the _side_ of another belt, its arriving items are forced onto the
  downstream belt's lane on the matching physical side, merging into that lane's
  flow under the forcing rule. The target belt's other lane is untouched. This
  is the canonical way one lane is filled while the other keeps flowing.

A belt facing into a non-belt (a splitter, a sink, or empty space) does not hand
off here — the splitter pulls from it and the sink drains it in their own phases
(below); a belt facing into nothing simply piles items at its output edge.

## Splitters

A splitter spans two tiles across the flow (footprint in `specs/prototypes.md`):
up to two input belts behind it and two output belts ahead of it, all sharing
its facing. It **balances** throughput:

- It pulls items from its two input belts in **round-robin** order (`rr_in`
  alternates `0`/`1`) and pushes them **round-robin across its four output
  lanes** — both lanes of both output belts.
- **Lanes are not preserved.** An item's input lane has no bearing on where it
  lands; the splitter balances _which belt_ **and** _which lane_. A saturated
  splitter therefore distributes evenly four ways: 20 items in becomes 10 on
  each output belt, with 5 on each lane of each belt. An input arriving on a
  single lane is spread across all four output lanes.
- A **base splitter holds no items between ticks** — each item it pulls is
  pushed in the same tick. Its only retained state is the two round-robin
  cursors `rr_in` and `rr_out`.

The output cursor `rr_out` runs over `0..4` and decodes as:

```
belt = rr_out & 1          // which output belt (0 or 1)
lane = rr_out >> 1         // 0 = left lane, 1 = right lane
```

so it walks `belt0/left → belt1/left → belt0/right → belt1/right` and wraps.
Alternating the **belt** on every step keeps the two output belts balanced at
every pair of items, while the lane flips every second step.

Exact base-splitter step, run each tick: attempt up to **two** transfers (so a
saturated pair of inputs both make progress). For each attempt:

1. Look at input belt `rr_in`. If there is no input belt there, flip `rr_in` and
   continue to the next attempt.
2. Pull the **lead item** that has reached the output edge (`pos == 0`) of that
   input belt — **left lane first, then right**. If neither lane has an item at
   the edge, flip `rr_in` and continue.
3. Resolve the destination from `rr_out`. If the belt it selects **does not
   exist**, advance `rr_out` (up to four times) until it selects a belt that
   does; a missing output belt is stepped past, not treated as back pressure, so
   a splitter with one output belt sends everything to that belt, alternating
   its two lanes.
4. Push the item onto that destination belt **and lane** under the forcing rule.
   If it lands, advance `rr_out` (mod 4), flip `rr_in`, and continue to the next
   attempt. If the push **stalls** (no output belt at all, or the force fails),
   **return the item to the input belt and lane it came from** (at `pos == 0`)
   and stop advancing this splitter for the rest of this tick.

A belt that exists but is **full** is real back pressure and does stall — that
is what makes a saturated line back up rather than silently drop throughput.

A splitter **breaks a transport line**: the compressed runs of belt on either
side cannot be merged across it. Priority and filter splitter modes are a future
variant.

## Inserters

An inserter sits on a tile. Its `dir` sets the tile it **drops onto** (the tile
in front, one step in `dir`) and the tile it **picks up from** (the tile behind,
one step opposite `dir`).

There is exactly **one kind of inserter**. It carries no tier, and every
inserter in the world swings at the same rate, `SWING` (see
`specs/prototypes.md`) — independent of where it sits and of the tier of any
belt it picks from or drops onto. An inserter entity therefore declares only
`x`, `y`, and `dir`.

It is a swing on an integer timer, run as a small state machine with two phases:

- **`idle`** (empty-handed): attempt to pick one item from the pickup tile. On
  success, take the item, set `phase = swing`, and set `swing_left = SWING`.
- **`swing`** (holding an item): if `swing_left > 1`, decrement it. When
  `swing_left == 1`, the swing is complete — attempt the **drop** onto the drop
  tile. If the drop lands, clear the held item, set `phase = idle` and
  `swing_left = 0`. If the drop **stalls** (no room), keep holding the item with
  `swing_left == 1` and retry the drop every following tick until it lands.

A base inserter carries **one item per swing**.

### Pickup

From the pickup tile, in order of what it is:

- From a **belt**: take the most-downstream item (smallest `pos`, the head of
  the lane) from the **far lane first, then the near lane** (far/near relative
  to the inserter's facing). It does not require the item to be at the output
  edge — it takes the lead item of the lane.
- From an **assembler**: take one of any item present in the output buffer
  (lowest item index first, for determinism), decrementing that item's count.
- From a **source**: take the source's item (infinite supply).

If nothing is available, the inserter stays `idle`.

### Drop

Onto the drop tile, by what it is:

- Onto a **belt**: **force** the item onto the **near lane** (relative to the
  inserter) at the standard entry coordinate `pos = TILE - SPACING`, under the
  forcing rule. Stalls if the gap is smaller than `SPACING`.
- Into an **assembler**: add one to the input buffer **iff** the item is one the
  recipe consumes **and** that item's buffered count is `< INPUT_CAP`. Otherwise
  the drop stalls.
- Into a **sink**: the item is consumed and counted; the drop always lands.

Because the drop onto a belt is a _forced_ insertion, inserters are one of the
three things (with sources and side-loading) that can squash a belt.

## Assemblers

An assembler occupies a 3×3 block (footprint in `specs/prototypes.md`) and
crafts to its `recipe`. It holds a bounded **input buffer** and **output
buffer**, each a per-item count map; inserters feed the input buffer and remove
from the output buffer (above). Each tick, in this order:

1. If `craft_left > 1`: decrement `craft_left` (crafting in progress).
2. If `craft_left == 1`: the craft finishes this tick — deposit one **output
   set** (add each output term's count to the output buffer) and set
   `craft_left = 0`. The room check was done at craft start, so a started craft
   always has room to deposit.
3. If now idle (`craft_left == 0`): attempt to **start a craft**. The gate,
   checked exactly: the input buffer holds **a full recipe input set** (every
   input item's buffered count `>=` the recipe's required count) **and** the
   output buffer has **room for the recipe's output set** (for every output
   term, `current_count + out_count <= OUTPUT_CAP`). If both hold, **consume one
   input set immediately** (subtract each input term's count) and set
   `craft_left = CRAFT`. If not, the assembler stays idle (`craft_left == 0`,
   not crafting).

So a backed-up assembler whose output buffer is full **pauses** rather than
overflowing — it stops consuming inputs until its output buffer drains.

## Sources

A source emits its configured `item` onto its configured `lane`(s) of the belt
one tile downstream (one step in the source's `dir`), once every `period` ticks
— but only when the target gap can accept a forced item.

- **Cadence:** an emission is attempted on tick `t` iff
  `t > 0 && t % period == 0`. The simulation starts empty at tick 0, so the
  first emission is attempted at `t = period`. (The tick a source emits on is
  the tick being _advanced into_.)
- The emission targets the downstream belt's near-lane entry slot
  (`pos = TILE - SPACING`) and lands under the **forcing rule**: if the gap is
  smaller than `SPACING`, the emission for that tick is simply
  **dropped** (the source has infinite supply but does not queue — a backed-up
  source's emissions are not produced). For `lane = "both"`, attempt left then
  right independently.

## Sinks

A sink consumes **every** item that reaches it — flowed in along a belt that
faces directly into the sink tile, or dropped in by an inserter — removing it
from the world and incrementing `consumed[item]`. It has no capacity. Each tick
a sink drains every item that has reached the output edge (`pos == 0`) of each
belt feeding directly into it (left lane then right, repeatedly until none
remain at the edge).

## The deterministic tick order

This is the contract that makes "the state after _N_ ticks" a single value. Each
tick runs **six phases in this exact sequence**, and within each phase the
entities are visited in **scenario placement order** (the order they appear in
the scenario's `entities` array):

1. **Sources** emit.
2. **Inserters** advance their swing state machine (pickup → swing countdown →
   drop).
3. **Belts** advance: first compact every lane, then hand off lead items to
   downstream belts.
4. **Splitters** balance.
5. **Assemblers** craft.
6. **Sinks** consume.

After the six phases the tick counter increments. The simulation starts at tick
0 with an empty world (every buffer empty, every belt empty, every inserter
idle, every sink at zero); a scenario's first snapshot is taken after the
requested number of ticks have run. Your engine may advance the world however
efficiently it likes, but it must land on **exactly** the state this order
produces — every faithful engine, naive or optimized, agrees on it to the bit.
