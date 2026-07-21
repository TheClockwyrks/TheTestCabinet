---
title: "Lattice — overview"
---

**Lattice** is the first [performance](/testing/performance/overview/) test case.
It asks a model to write a **deterministic factory simulation engine** — belts,
splitters, inserters, assemblers, and the test fixtures that feed and drain them —
and then scores that engine on how little **work** it does to simulate a factory
correctly. This page documents the **rules of the simulation**; the reference
engine, the contract the model implements, and the fixed-point/replay machinery are
covered in
[Engine & contract](/testing/performance/lattice/architecture/), and
what the model is handed to build against in
[Reference material](/testing/performance/lattice/references/).

For the test-type-level framing — the wasm sandbox, fuel metering, and the
correctness-then-fuel scoring order — read the
[performance overview](/testing/performance/overview/) first; this page only adds
what is specific to Lattice.

:::note[Provenance]
Lattice descends from **Factorio**'s belt-and-machine logistics simulation, the
canonical example of a game built around a **fully deterministic** fixed-point
simulation — the same property that lets Factorio run multiplayer in **lockstep**,
with every client simulating independently and staying bit-for-bit identical. That
determinism is exactly what makes it a good performance case: a factory's behaviour
is a pure function of its layout and a tick count, so a reference engine can produce
an unambiguous **expected output** for any scenario, and a submission is correct iff
it reproduces that output exactly.

The belt mechanics below — two-lane belts, item compaction, and the transport-line
representation that the efficient solution exploits — follow Factorio's own design
as documented in its *Friday Facts* dev blog:
[FFF #176 (transport-line optimization)](https://www.factorio.com/blog/post/fff-176),
[FFF #231 (belt compression)](https://www.factorio.com/blog/post/fff-231), and
[FFF #276 (belt item spacing)](https://www.factorio.com/blog/post/fff-276).

The on-disk slug is `lattice`, matching the in-fiction title **Lattice**.
Lattice does not try to reproduce the full breadth
of Factorio — it fixes a small, precisely-specified subset of entities and rules
and asks for them to be simulated *fast*.
:::

## The world

A scenario plays out on a fixed **tile grid**. Each tile holds at most one
**entity**, entities are **placed once** at tick 0 from the scenario's blueprint
and never change afterward (the layout is static; only the items moving through it
change), and the simulation advances by a **fixed timestep** for a scenario-declared
number of **ticks**. There is no player and no in-flight construction: a scenario is
a factory layout plus "run it for *N* ticks," and the question is what state the
factory is in at the end.

Everything is **integer / fixed-point** (see
[Determinism](/testing/performance/lattice/architecture/#determinism-and-the-canonical-state)).
There are no floating-point positions anywhere in the model: item positions, belt
speeds, swing timers, and craft progress are all integers, so "the state after *N*
ticks" is a single well-defined value that every correct engine must agree on to the
bit. This is the linchpin of the whole case — it is what turns "simulate a factory"
into a problem with one right answer.

The base entity set is six pieces:

- **Belts** — move items in a direction, with **two independent lanes**.
- **Splitters** — balance items across two belts in and two belts out.
- **Inserters** — swing a single item from one tile onto an adjacent tile.
- **Assemblers** — consume input items and craft an output to a recipe.
- **Sources** — test fixtures that emit a fixed item onto a belt at a fixed cadence.
- **Sinks** — test fixtures that consume and count whatever reaches them.

Sources and sinks are the **measurement fixtures** — the deterministic way a
scenario gets items into the factory and the place their throughput is observed —
analogous to how a hardware test rig drives known inputs in and reads outputs back.

## Belts and the two-lane model

A belt occupies one tile, faces one of **N / S / E / W**, and carries items in that
direction. Crucially, every belt tile has **two lanes** — a **left** and a **right**
lane relative to the direction of travel — and the two lanes are **fully
independent** 1-D tracks. An item lives on exactly one lane and never changes lanes
on a straight belt. The two-lane design is deliberate: it is where careful
bookkeeping is required, because a belt can have one lane saturated and the other
empty, and feeding logic (below) acts on a single lane at a time.

### The fixed-point item model

Within a lane, an item's position is a single integer: its distance, in **position
units**, from the lane's **output end** (the downstream edge of the tile, in the
direction of travel). One tile of lane length is **`TILE` units** (a
power-of-two constant — representatively `256`), and two constants govern movement:

- **`SPACING`** — the minimum centre-to-centre distance between two items on the
  same lane (representatively `TILE / 4` = `64` units, i.e. four items per tile per
  lane). Two items may never be closer than `SPACING`.
- **`SPEED`** — how many units an unobstructed item advances per tick. Every belt
  runs the same `SPEED` (a belt's `tier` is cosmetic), and the inserter `SWING` is
  tied to it so an item moves at the same speed on a belt or in a claw.

The authoritative constants live in the case's specs and prototype table, not here;
what matters is that they are **integers**, so the arithmetic below is exact.

### Movement and compaction

Each tick, each lane is advanced by walking its items **from the output end
backward** and moving each one as far forward as it can go:

```
new_pos = min(pos + SPEED,            // its own speed, and …
              ahead_pos + SPACING,    // never closer than SPACING to the item ahead
              lane_head_limit)        // never past a blocked downstream end
```

(`pos` is measured from the output end, so "forward" *decreases* it; the formulae
read most naturally with that sign convention in mind — the engine's job is the
clamp, not the algebra.) Two consequences fall straight out of this rule, and they
are the entire compaction story:

- A gap **larger** than `SPACING` shrinks by up to `SPEED` each tick as the trailing
  item rolls forward, until it closes to exactly `SPACING`. Belt movement therefore
  **compresses** a stream toward the standard spacing on its own.
- Belt movement **can never create** a gap smaller than `SPACING`, and once a run of
  items is packed at `SPACING` it moves forward as a rigid block. Crucially, a "run"
  here is a whole **line of collinear belts**, not one tile: a straight line of same-
  facing belts is advanced as **one long lane**, so a packed line reads as *frozen*
  (its positions are constant tick to tick) and, when its front is consumed, the whole
  line shifts one slot in a single tick — the freed space appears only at the very
  back, never as a hole crawling backward tile by tile. This is Factorio's "**once a
  belt compresses, it stays that way**"
  ([FFF #176](https://www.factorio.com/blog/post/fff-176)) — and it is exactly the
  property the efficient engine exploits (see
  [the transport-line representation](/testing/performance/lattice/architecture/#why-this-is-a-performance-case)).

A gap **smaller** than `SPACING` can only ever appear when something **forces** an
item in — an inserter dropping onto the belt, a source emitting, or a belt
**side-loading** onto another belt. Per
[FFF #231](https://www.factorio.com/blog/post/fff-231), an item may be forced into
any gap of **at least** `SPACING`; it may land closer than standard spacing to its
new neighbours, and the next time the belt moves the gap re-expands to the standard
size. A gap **smaller** than `SPACING` cannot accept a forced item at all — the
inserter or source **stalls** and holds its item until room opens. This single rule
— *forcing is allowed into a standard-or-larger gap and may squash temporarily; belt
motion never makes a sub-standard gap and always relaxes back to standard* — is the
compaction contract the model must get exactly right.

The bound is inclusive for a reason: the standard entry coordinate is
`TILE - SPACING`, which on a compacted lane sits exactly `SPACING` behind the item
ahead. An exclusive bound would refuse every such force, leaving the last slot of
each tile permanently empty and capping a "full" belt at three items per tile.

### Belt-to-belt feeding

How one belt hands items to the next is where the two-lane model earns its keep:

- **End-feeding** (a belt pointing straight into the next belt's input edge): the two
  belts are the same **run** and move as one lane — an item crosses the seam by an
  ordinary `SPEED`-step, no hand-off. Each lane flows into the **same lane** of the
  downstream belt. Left feeds left, right feeds right; the two streams stay separate.
- **Side-loading** (a belt pointing into the *side* of another belt): the incoming
  belt forces its items onto the **single lane nearest the source** of the target
  belt, merging into that lane's flow under the forcing rule above. The target belt's
  other lane is untouched. Side-loading is the canonical way one lane of a belt is
  filled while the other keeps flowing — and the place a naive engine most often
  gets compaction wrong.
- **Curves** (a belt whose sole input comes from a perpendicular neighbour) remap the
  incoming lanes onto this tile's lanes as the stream turns. In the **base** variant
  the two lanes are treated as equal-length through the curve; Factorio's realistic
  **inner-lane-shorter** curve geometry is a planned harder
  [variant](#variants).

## Splitters

A splitter spans **two tiles** across the flow: two belt lanes-pairs in, two out. It
exists to **balance** throughput, and in the base ruleset it does so the simple way:

- Items are pulled from the two input belts in **round-robin** order and pushed
  **round-robin across the four output lanes** — both lanes of both output belts —
  so a saturated input is split evenly four ways and two inputs merge evenly onto
  both.
- **Lanes are not preserved**: an item's input lane has no bearing on where it
  lands. The splitter balances *which belt* **and** *which lane*, so 20 items in
  becomes 10 per output belt with 5 on each lane, and an input arriving on a single
  lane comes out spread across all four.

A splitter **breaks a transport line** — the long compressed run of belts on either
side cannot be merged across it — which matters to the efficient representation, not
to the rules. **Priority** and **filter** splitter modes are a planned
[variant](#variants); the base splitter is a plain balancer.

## Inserters

An inserter sits on a tile and moves items between the tile **behind** it (its
**pickup**) and the tile **in front** (its **drop**), set by its facing. It is a
**swing**, not an instant transfer, and runs as a small state machine on an integer
timer:

- It **picks up** one item from the pickup tile — from a belt it takes from a
  defined lane order (the far lane first, then the near), from an assembler's output
  buffer, or from a source — but **only when its drop target can accept that item
  right now**. Otherwise it waits with empty claws rather than grabbing an item it
  could not deposit, so it never hovers over a full target holding an item (except in
  a two-inserter race for one buffer).
- It then **swings** for a fixed `SWING` ticks, holding the item. There is one kind
  of inserter, so this is a single constant: every inserter swings at the same rate,
  wherever it sits and whatever belts it touches.
- It **drops** the item onto the drop tile — onto a belt it **forces** the item onto
  a defined lane under the compaction rule (stalling if there is no large-enough gap),
  into an assembler's input buffer, or into a sink.

A base inserter carries **one item per swing** (stack inserters that grab several are
a planned [variant](#variants)). Because the drop onto a belt is a *forced*
insertion, inserters are one of the three things (with sources and side-loading) that
can squash a belt — tying the inserter cadence directly to the compaction rules
above.

## Assemblers

An assembler occupies a **3×3 block of tiles** (as in Factorio), anchored at its
scenario `(x, y)`; inserters interact with it from any tile adjacent to that
footprint. It crafts to a **recipe** — a set of input items with counts, one output
item with a count, and a `CRAFT` tick cost:

- It holds a bounded **input buffer** and **output buffer**. Inserters feed the input
  buffer and remove from the output buffer.
- When the input buffer holds a full set of recipe inputs **and** the output buffer
  has room, the assembler consumes one set, counts up `CRAFT` ticks, and then deposits
  one output set. If the output buffer is full it **pauses** rather than overflowing
  (so a backed-up assembler stops consuming inputs, exactly as a real one does).

Recipes are declared in the case's prototype table; a scenario names a recipe per
assembler. Multi-output recipes and crafting speed modules are out of scope for the
base case.

## Sources and sinks

These are the **test fixtures**, not Factorio entities — they exist so a scenario is
self-contained and its result is observable:

- A **source** emits a configured **item** onto its output, on a configured **lane**,
  once every configured **period** of ticks — but only when the target gap can accept
  a forced item (it respects compaction; a backed-up source stalls and its emissions
  are simply not produced). A source has infinite supply and is the deterministic way
  items enter a factory.
- A **sink** consumes **every** item that reaches it — flowed in by belt or dropped in
  by an inserter — and **counts** it per item type. Consumed items leave the world, so
  a sink is a perfect drain as well as the natural place to read a layout's
  throughput.

Because sources and sinks are deterministic and infinite, a scenario needs nothing
outside its own blueprint to run, and "how many of item X did sink Y consume by tick
N" is a fully-defined number — though, as below, correctness is checked on far more
than just the sink totals.

## What "correct" means

Lattice has no winner and no score *within* a scenario — it has a **right answer**.
At each **snapshot tick** the scenario declares, the engine must produce the
**complete canonical state** of the factory: every item's lane and position on every
belt, every inserter's phase and held item, every assembler's buffers and craft
progress, and every sink's running counts — all in the fixed-point, fully-specified
[canonical form](/testing/performance/lattice/architecture/#determinism-and-the-canonical-state).
A submission is **correct** on a scenario iff its canonical state matches the
reference engine's at **every** snapshot, bit for bit (in practice compared by the
state **checksum**, Factorio's own desync-detection model). A single divergent item
position anywhere fails the scenario — there is no partial credit on correctness,
because a simulation that is subtly wrong is not the same simulation.

Only once an engine is correct does its **fuel** — how much work it did to get there —
become its result. The whole point of the case is that there is an enormous gap
between a correct-but-naive engine and a correct-and-efficient one; that gap, and why
it exists, is the subject of
[Engine & contract](/testing/performance/lattice/architecture/#why-this-is-a-performance-case),
and how fuel becomes a result is the shared
[performance evaluation](/testing/performance/evaluation/).

## Variants

As with every test type, a Lattice case offers one or more
[variants](/testing/performance/manifests/) and exactly one runs per run — here a
different factory **scale** or an added **rule**. Planned directions, each layered on
the base ruleset above:

- **Scale.** The same ruleset against a much larger grid and tick count, where the
  efficiency gap between a naive and a transport-line engine is decisive rather than
  merely visible.
- **Realistic curves.** Factorio's inner-lane-shorter curve geometry, so a turning
  belt's two lanes advance at different rates.
- **Underground belts** and **long-handed inserters** — gap-spanning entities that
  complicate the transport-line merging.
- **Priority / filter splitters** and **stack inserters** — richer routing and
  throughput behaviour on the existing entities.
