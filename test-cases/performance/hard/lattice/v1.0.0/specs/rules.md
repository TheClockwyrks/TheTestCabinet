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
changes lanes on a straight belt. Every belt moves at the one uniform `SPEED` (see
`specs/prototypes.md`); a belt's `tier` is cosmetic and does not change its speed.

### The fixed-point item model

Within a lane, an item's position `pos` is a single integer in `0..TILE`, its
distance from the lane's **output end** (the downstream edge). Position
decreases toward the output: `pos = 0` is exactly at the output edge. Two items
on the same lane may never be closer than `SPACING`.

A lane's items are kept in **ascending `pos`** order — the lead item (smallest
`pos`, closest to the output) first.

### Runs: a line of belts moves as one lane

Movement is defined over a **run**, not a single tile. A run is a maximal chain
of **collinear, same-direction** belts that end-feed one another — a straight
line of belts of the same facing, one flowing into the next's input edge. A run's
two lanes are each one continuous track spanning every tile in the run; the tile
boundaries inside a run are seams in the _addressing_ (each item still reports a
per-tile `pos`), not breaks in the flow.

A run **breaks** wherever continuous same-direction flow stops: at a belt facing
a **splitter**, a **sink**, an **inserter**'s pickup tile, empty space, or a
**perpendicular** belt (a curve or a side-load — those connect by _forcing_, not
by run flow; see "Belt-to-belt feeding"). So a splitter, a sink, or a turn each
starts a fresh run on its far side.

Address an item on run tile `i` (counting `0` from the run's **output** end) at
position `p` by the run-global coordinate `g = i * TILE + p`. The run's output
edge is `g = 0`.

### Movement and compaction

Each tick, each **run** lane is advanced by walking its items **from the output
end backward** (lead item first) and moving each one as far forward as it can go.
Writing the clamp in run-global `g` (an item moves by the `SPEED` of the tile it
currently sits on):

```
new_g = max(g - SPEED,            // its own speed (forward = decreasing g)
            ahead_g + SPACING)    // never closer than SPACING to the item ahead
```

- The **lead item** (no item ahead of it) clamps only against the run's output
  edge: `new_g = max(g - SPEED, 0)`.
- Every following item clamps against the item ahead of it **after that item has
  already moved this tick** (you walk lead-first), so
  `new_g = max(g - SPEED, ahead_new_g + SPACING)`.

Because the whole run is one lane, an item crossing a tile seam is an ordinary
`SPEED`-sized step — it simply lands on the next tile down (`g` decreasing across
`i * TILE`) with no jump or extra spacing. There is no separate per-tile hand-off
for collinear belts.

Two consequences fall straight out, and they are the entire compaction story:

- A gap **larger** than `SPACING` shrinks by up to `SPEED` each tick as the
  trailing item rolls forward, until it closes to exactly `SPACING`. Belt
  movement **compresses** a stream toward standard spacing on its own.
- Belt movement **can never create** a gap smaller than `SPACING`, and once a run
  is packed at `SPACING` **the entire run moves forward as a single rigid block**.
  A packed run reads as **frozen** — its per-tile positions are the same every
  tick — and when its front item is consumed the whole run shifts one slot in the
  _same_ tick, the freed slot appearing only at the run's very back (never a hole
  crawling backward tile by tile). _Once a belt compresses, it stays that way_ —
  and that is exactly the property an efficient engine exploits (see
  `specs/contract.md` and the overview).

A gap **smaller** than `SPACING` can only ever appear when something **forces**
an item in at a non-standard coordinate — an inserter dropping, a source
emitting, or a belt **side-loading** into a lane whose items are not on the
standard grid.

### Forcing an item onto a lane

An item may be forced into a gap of **at least `SPACING`**: it may land closer
than standard spacing to its new neighbors, and the next time the belt moves
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

- **End-feeding** (the two belts are collinear, same facing) is **not** a
  hand-off — the two belts are part of the same **run** and move as one lane
  (above). An item crosses the shared seam as an ordinary `SPEED`-step and each
  lane flows into the **same** lane of the downstream belt (left → left,
  right → right). Nothing special happens at the boundary.

The remaining cases are **cross-run forcings**: the feeder's lead item, once it
has reached that belt's output edge (`pos == 0`), is forced onto the target
belt's lane at the standard entry coordinate `pos = TILE - SPACING`, **iff the
target lane can accept it under the forcing rule** above (one item per tick);
otherwise it stays put and the run behind it stays blocked.

- **Curves** (the downstream belt faces a perpendicular direction): the lanes
  remap **equal-length** in the base ruleset — the physical (outer/inner) side
  is carried across the turn, so the lane on a given physical side stays on that
  side. (Factorio's realistic inner-lane-shorter curve geometry is a future
  variant; in v1 both lanes are equal length through a curve.)
- **Side-loading**: when a belt faces into the _side_ of another belt, its
  arriving items are forced onto the target belt's lane on the matching physical
  side, merging into that lane's flow under the forcing rule. The target belt's
  other lane is untouched. This is the canonical way one lane is filled while the
  other keeps flowing.

A belt facing into a non-belt (a splitter, a sink, or empty space) does not feed
across here — the splitter pulls from it and the sink drains it in their own
phases (below); a belt facing into nothing simply piles items at its output edge
(and its run ends there).

## Splitters

A splitter spans two tiles across the flow (footprint in `specs/prototypes.md`):
up to two input belts behind it and two output belts ahead of it, all sharing
its facing. It **balances** throughput:

- It processes **every input lane that has an item at its output edge this tick** —
  both lanes of both input belts — so two items arriving **side by side on one input
  belt** move **together**, on the same tick, not one lane this tick and the other
  next.
- **The input lane is preserved.** An item moves across **belts**, never across
  **lanes**: a left-lane item can only land on an output belt's **left** lane, a
  right-lane item on a **right** lane. Which output _belt_ it goes to is the only
  choice the splitter makes.
- **The belt alternates per item type** (the Factorio splitter). The splitter keeps,
  per item type, which output belt that type's next item prefers; after routing an
  item of a type, that preference **flips to the other belt**, so the following item
  of the same type goes the other way. So two full input belts of two different items
  — a top belt of iron, a bottom belt of copper — split so **each output belt
  receives one iron and one copper** (across its two lanes), never one belt all iron
  and the other all copper.
- A **base splitter holds no items between ticks** — each item it processes is pushed
  the same tick. Its only retained state is the per-type preference cursor
  (`next_belt`, one bit per item type).

Exact base-splitter step, run each tick: for each input belt (belt 0 then belt 1),
and each lane (left then right):

1. Take that lane's **lead item** only if it has reached the output edge (`pos == 0`);
   otherwise skip the lane.
2. Let `pref` be this item type's preferred output belt (its `next_belt` bit). Try to
   force the item onto belt `pref`, on the **same lane** it came in on. If that output
   belt does not exist or its lane is full, try the **other** belt (same lane).
3. If it lands, flip this type's `next_belt` bit to the belt **opposite** the one it
   landed on, so the next item of the type alternates. If **neither** output belt can
   take it, **return the item to its lane** (`pos == 0`) — real back pressure — and it
   retries next tick.

A missing output belt is simply an unavailable destination (never back pressure), so
a splitter with one output belt sends everything to that belt, alternating its two
lanes as items alternate. A belt that **exists but is full** is real back pressure and
stalls, backing the inputs up.

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

It is a swing on an integer timer, run as a small state machine with three phases —
the loaded swing out, the empty swing back, and idle at rest:

- **`idle`** (empty-handed, back at the pickup): it grabs an item **only when the
  drop tile can accept it right now**. It peeks the item it _would_ pick up (without
  removing it) and checks the drop target: if the target can currently take that
  item, it takes the item, sets `phase = swing`, and sets `swing_left = SWING`;
  otherwise it **waits empty** — it does **not** grab an item it could not deposit.
  An inserter facing a target that can never accept (a wall, or the wrong assembler
  input) therefore never picks up.
- **`swing`** (holding an item, swinging out): if `swing_left > 1`, decrement it.
  When `swing_left == 1`, the swing is complete — attempt the **drop** onto the drop
  tile. If the drop lands, clear the held item and **begin the return**: set
  `phase = return` and `swing_left = SWING`. If the drop **stalls** (no room), keep
  holding the item with `swing_left == 1` and retry the drop every following tick
  until it lands.
- **`return`** (empty-handed, swinging back): decrement `swing_left` each tick. The
  empty return costs the **same `SWING` ticks** as the loaded swing — the arm
  actually travels back, it does **not** teleport back and re-grab the instant it
  drops. When `swing_left` reaches `0` the arm is back at the pickup and the phase
  becomes `idle`, ready to grab again. A full pick-and-place cycle is therefore
  `SWING` out + `SWING` back.

Because the pickup is gated on the target accepting, a lone inserter never hovers
over its target holding an item. That **only** happens in a race: two inserters
targeting one buffer both peek room and both grab in the same tick, and when their
swings finish only one drop lands — the loser then holds and retries, the one
sanctioned hold-with-item case.

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

If nothing is available — **or** the drop target cannot currently accept the item
that would be picked up (see the `idle` phase above) — the inserter stays `idle`
with empty claws.

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
3. **Belts** advance: first compact every run (each as one lane), then force the
   perpendicular curve / side-load merges across runs.
4. **Splitters** balance.
5. **Assemblers** craft.
6. **Sinks** consume.

After the six phases the tick counter increments. The simulation starts at tick
0 with an empty world (every buffer empty, every belt empty, every inserter
idle, every sink at zero); a scenario's first snapshot is taken after the
requested number of ticks have run. Your engine may advance the world however
efficiently it likes, but it must land on **exactly** the state this order
produces — every faithful engine, naive or optimized, agrees on it to the bit.
