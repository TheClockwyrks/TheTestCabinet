---
title: "Lattice — overview"
---

Lattice is a [performance](/testing/performance/overview/) test case. It asks a
model to write a deterministic factory simulation engine (belts, splitters,
inserters, assemblers, and the fixtures that feed and drain them) and scores that
engine on how little work it does to simulate a factory correctly.

This page documents the rules of the simulation. The reference engine, the
contract the model implements, and the canonical-state machinery are covered in
[Engine and contract](/testing/performance/lattice/architecture/), and what the
model is handed to build against in
[Reference material](/testing/performance/lattice/references/). The wasm sandbox,
fuel metering, and the correctness-then-fuel scoring order are covered in the
[performance overview](/testing/performance/overview/).

Lattice takes its belt-and-machine logistics from Factorio, a game built around a
fully deterministic fixed-point simulation. That determinism is what makes it a
good performance case: a factory's behaviour is a pure function of its layout and
a tick count, so a reference engine produces an unambiguous expected output for
any scenario, and a submission is correct exactly when it reproduces that output.
The belt mechanics below follow Factorio's own design as documented in
[FFF #176](https://www.factorio.com/blog/post/fff-176),
[FFF #231](https://www.factorio.com/blog/post/fff-231), and
[FFF #276](https://www.factorio.com/blog/post/fff-276). Lattice fixes a small,
precisely specified subset of entities and rules and asks for them to be
simulated fast. The on-disk slug is `lattice`.

## The world

A scenario plays out on a fixed tile grid. Each tile holds at most one entity,
entities are placed once at tick 0 from the scenario's blueprint and never change
afterward, and the simulation advances by a fixed timestep for a
scenario-declared number of ticks. A scenario is a factory layout plus a tick
count, and the question is what state the factory is in at the end.

Everything is integer and fixed-point. Item positions, belt speeds, swing timers,
and craft progress are all integers, so the state after *N* ticks is a single
well-defined value every correct engine agrees on to the bit. That is what turns
"simulate a factory" into a problem with one right answer.

The entity set is six pieces:

- Belts move items in a direction, with two independent lanes.
- Splitters balance items across two belts in and two belts out.
- Inserters swing a single item from one tile onto an adjacent tile.
- Assemblers consume input items and craft an output to a recipe.
- Sources are fixtures that emit a fixed item onto a belt at a fixed cadence.
- Sinks are fixtures that consume and count whatever reaches them.

Sources and sinks are the measurement fixtures: the deterministic way a scenario
gets items into the factory and the place their throughput is observed.

## Belts and the two-lane model

A belt occupies one tile, faces north, south, east, or west, and carries items in
that direction. Every belt tile has two lanes, left and right relative to the
direction of travel, and the two lanes are fully independent 1-D tracks. An item
lives on exactly one lane and never changes lanes on a straight belt.

The two-lane design is where careful bookkeeping is required: a belt can have one
lane saturated and the other empty, and feeding logic acts on a single lane at a
time.

### The fixed-point item model

Within a lane, an item's position is a single integer: its distance, in position
units, from the lane's output end, the downstream edge of the tile. One tile of
lane length is `TILE` units, and two constants govern movement:

- `SPACING`, the minimum centre-to-centre distance between two items on the same
  lane. Two items may never be closer than `SPACING`.
- `SPEED`, how many units an unobstructed item advances per tick. A belt's `tier`
  sets it: `slow`, `fast`, and `express` run at one, two, and three times the
  reference speed, so a higher tier is genuinely more throughput rather than a
  recolour. Speed is a property of the tile, so a mixed-tier line moves at mixed
  rates. The inserter `SWING` is tied to the `fast` reference speed, so an item
  moves at the same rate on a `fast` belt or in a claw.

The values live in the case's prototype table. They are integers, so the
arithmetic below is exact.

### Movement and compaction

Each tick, each lane is advanced by walking its items from the output end
backward and moving each one as far forward as it can go:

```
new_pos = min(pos + SPEED,            // its own speed, and …
              ahead_pos + SPACING,    // never closer than SPACING to the item ahead
              lane_head_limit)        // never past a blocked downstream end
```

`pos` is measured from the output end, so moving forward decreases it. Two
consequences fall out of this rule, and they are the whole compaction story:

- A gap larger than `SPACING` shrinks by up to `SPEED` each tick as the trailing
  item rolls forward, until it closes to exactly `SPACING`. Belt movement
  compresses a stream toward the standard spacing on its own.
- Belt movement never creates a gap smaller than `SPACING`, and once a run of
  items is packed at `SPACING` it moves forward as a rigid block. A run here is a
  whole line of belts rather than one tile: a line of belts that end-feed one
  another advances as one long lane, so a packed line's positions are constant
  tick to tick, and when its front is consumed the whole line shifts one slot in
  a single tick. The freed space appears at the very back. This is Factorio's
  property that a compressed belt stays compressed, and it is what the efficient
  engine exploits.

A gap smaller than `SPACING` appears only when something forces an item in: an
inserter dropping onto the belt, a source emitting, or a belt side-loading onto
another belt. An item may be forced into any gap of at least `SPACING`. It may
land closer than standard spacing to its new neighbours, and the next belt
movement re-expands the gap to the standard size. A gap smaller than `SPACING`
accepts no forced item, and the inserter or source stalls and holds its item
until room opens.

The bound is inclusive because the standard entry coordinate is `TILE - SPACING`,
which on a compacted lane sits exactly `SPACING` behind the item ahead. An
exclusive bound would refuse every such force, leaving the last slot of each tile
permanently empty and capping a full belt at three items per tile.

### Belt-to-belt feeding

- End-feeding, where a belt points straight into the next belt's input edge, is
  not a hand-off. The two belts are the same run and move as one lane, so an item
  crosses the seam by an ordinary `SPEED` step. Each lane flows into the same lane
  of the downstream belt, so left feeds left and right feeds right.
- Side-loading, where a belt points into the side of another belt, forces the
  incoming items onto the single lane nearest the source of the target belt,
  merging into that lane's flow under the forcing rule. The target belt's other
  lane is untouched. This is the canonical way one lane of a belt is filled while
  the other keeps flowing, and the place a naive engine most often gets compaction
  wrong.
- Curves, where a belt bends 90° into the belt ahead of it, are part of the run
  rather than a hand-off, as long as that bend's only feed is the belt before it.
  Such a pure curve carries both lanes through the turn by an ordinary `SPEED`
  step, exactly like a straight belt, and the lane is preserved: left stays left
  and right stays right, so the physical outer/inner side is carried across the
  turn. The base ruleset treats the two lanes as equal length through the curve. A
  bend that also has its own straight feed, or a second thing pointing into it, is
  a side-load rather than a curve.

A side-load is a cross-run forcing, and it moves the feeder's lead item only once
it has reached that belt's output end, at most one item per tick. Otherwise it
stays put, and the run behind it stays blocked.

## Splitters

A splitter spans two tiles across the flow: up to two input belts behind it and
two output belts ahead of it, all sharing its facing. It balances throughput:

- Every input lane with an item at its output edge moves on the same tick, across
  both lanes of both input belts, so items arriving side by side move together.
- The input lane is preserved. An item moves across belts, never across lanes, so
  a left-lane item stays on a left lane. Which output belt it goes to is the only
  choice the splitter makes.
- Each lane alternates its output belt, ignoring item type. The splitter keeps no
  per-type state: per lane it remembers which output belt that lane's next item
  prefers, whatever that item is, and flips the preference after routing one. The
  two lanes carry independent cursors, so a lane is balanced only against the
  corresponding lane of the other output belt, never against the other lane of its
  own belt. The balance is by count rather than by type: two full input belts of
  different items are split so that each output belt gets an equal share of the
  total flow over time, though a single tick may hand one belt a row of iron and
  the other a row of copper.
- The two input belts are tried in an alternating order that flips every tick, so
  neither is starved when both compete for one output lane.

A base splitter holds no items between ticks. Its retained state is the per-lane
output preference and the input-order cursor. A missing output belt is an
unavailable destination rather than back pressure, while an output belt that
exists and is full stalls and backs the inputs up.

A splitter breaks a transport line, so the compressed runs of belt on either side
cannot be merged across it. That matters to the efficient representation rather
than to the rules.

## Inserters

An inserter sits on a tile. Its facing sets the tile it drops onto, one step
ahead, and the tile it picks up from, one step behind. There is one kind of
inserter, so every inserter swings at the same rate and carries one item per
swing. It runs as a small state machine on an integer timer:

- Idle. It grabs an item only when the drop target can accept that item right
  now, so it never hovers over a full target holding an item. From a belt it takes
  the lead item of the far lane first, then the near lane; the lanes are named
  relative to the inserter's facing, and because it picks from the tile behind
  itself, that far lane is the one physically closer to it, so it reaches for the
  closer item first. From an assembler it takes one item from the output buffer;
  from a source it takes the source's item.
- Swing. It holds the item for `SWING` ticks and then drops it. Onto a belt it
  forces the item onto the near lane at the standard entry coordinate, and stalls
  if the gap is too small. Into an assembler it adds one to the input buffer when
  the recipe consumes that item and the buffer has room. Into a sink the drop
  always lands.
- Return. It swings back empty over another `SWING` ticks before it is idle again,
  so a full pick-and-place cycle is `SWING` out and `SWING` back.

Because the drop onto a belt is a forced insertion, inserters are one of the
three things, with sources and side-loading, that can squash a belt.

## Assemblers

An assembler occupies a 3×3 block of tiles anchored at its scenario position, and
inserters interact with it from any tile adjacent to that footprint. It crafts to
a recipe: a set of input items with counts, an output item with a count, and a
`CRAFT` tick cost.

It holds a bounded input buffer and output buffer, both per-item count maps.
Inserters feed the input buffer and remove from the output buffer. When the input
buffer holds a full set of recipe inputs and the output buffer has room for the
output set, the assembler consumes one input set immediately, counts up `CRAFT`
ticks, and then deposits one output set. A full output buffer pauses the
assembler rather than overflowing it, so a backed-up assembler stops consuming
inputs.

Recipes are declared in the case's prototype table, and a scenario names a recipe
per assembler.

## Sources and sinks

A source emits its configured item onto its configured lanes of the belt one tile
downstream, once every configured period of ticks, and only when the target gap
can accept a forced item. It has infinite supply and does not queue: a backed-up
source's emission for that tick is simply not produced.

A sink consumes every item that reaches it, flowed in by belt or dropped in by an
inserter, and counts it per item type. Consumed items leave the world, so a sink
is a perfect drain and the natural place to read a layout's throughput.

Because sources and sinks are deterministic and infinite, a scenario needs
nothing outside its own blueprint to run.

## The deterministic tick order

Each tick runs six phases in this exact sequence, and within each phase entities
are visited in scenario placement order:

1. Sources emit.
2. Inserters advance their swing state machine.
3. Belts advance: first compact every run as one lane, carrying its pure curves
   through with it, then force the perpendicular side-load merges across runs.
4. Splitters balance.
5. Assemblers craft.
6. Sinks consume.

The tick counter then increments. The simulation starts at tick 0 with an empty
world, and a scenario's first snapshot is taken after the requested number of
ticks have run. An engine may advance the world however efficiently it likes, as
long as it lands on exactly the state this order produces.

## The correctness criterion

Lattice has one right answer per scenario. At each snapshot tick the scenario
declares, the engine must produce the complete canonical state of the factory:
every item's lane and position on every belt, every inserter's phase and held
item, every assembler's buffers and craft progress, and every sink's running
counts, all in the
[canonical
form](/testing/performance/lattice/architecture/#determinism-and-the-canonical-state).

A submission is correct on a scenario exactly when its canonical state matches
the reference engine's at every snapshot, compared by checksum. A single
divergent item position anywhere fails the scenario. There is no partial credit,
because a simulation that is subtly wrong is not the same simulation.

Only once an engine is correct does its fuel become its result. The gap between a
correct-but-naive engine and a correct-and-efficient one is the subject of
[Engine and
contract](/testing/performance/lattice/architecture/#the-efficiency-spread),
and how fuel becomes a result is covered in
[Evaluation](/testing/performance/evaluation/).

## Variants

Exactly one [variant](/testing/performance/manifests/) runs per run. The shipped
base variant is the ruleset above, scored against the held-out set. Further
variants layer a different factory scale or an added rule on that ruleset:
Factorio's inner-lane-shorter curve geometry, underground belts and long-handed
inserters, and priority or filter splitters and stack inserters.
