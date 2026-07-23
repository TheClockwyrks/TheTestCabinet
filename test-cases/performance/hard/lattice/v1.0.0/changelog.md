Introduced.

Splitter spec corrected to match the engine (a stale oracle regenerated):

- **The seeded specs described an out-of-date splitter.** `rules.md`,
  `canonical-state.md`, `contract.md`, and the state schema said the balancer kept a
  per-item-type cursor (`next_belt`, one bit per type); the engine actually keeps a
  per-(item-type, **lane**) cursor (`out_pref`, bit `t*2 + L`) plus an input-order
  cursor (`in_first`). Keeping it per lane is what lets one belt full of a single item
  on both lanes fill **both lanes of both outputs** instead of "unzipping" one lane to
  each. The prose specs, the canonical byte layout (which had also dropped the
  `in_first` byte), and the seeded state schema now match the implementation, so an
  engine that faithfully follows the spec reproduces the oracle.
- **Regenerated a stale scored oracle.** `cases/small.out` predated the `out_pref`
  splitter field and could not even be parsed as an expected answer (it caused the
  validator's `missing field out_pref`); it — and three splitter training oracles that
  were stale for the same reason — have been re-solved against the current engine.

Scored set redesigned into realistic factories (all reference outputs regenerated):

- **`medium` and `large` are now dense, interconnected factories, not sparse
  parallel lines.** A new `bus` generator layout (`lattice gen --layout bus`) in which
  every source emits **only raw ore** and every intermediate is crafted on the grid:
  a circuit unit runs the full copper chain (copper-ore→copper-plate→copper-cable)
  curving into a two-input `circuit` assembler that an iron-plate line also feeds; a
  gear unit runs iron-ore→iron-plate→iron-gear; a smelt unit taps an ore bus into a
  wide row of plate assemblers with a **curve** and a **side-load** merge; a belt unit
  carries the balancing **splitter**; and assembler-dense **farm** units pack the
  rest. They stress every interconnection behavior — belt→belt inserter taps, curves,
  side-load merges, splitter balancing, and multi-stage crafting — where the earlier
  scored set was only independent east-flowing straight lines. Empty-belt tiles are
  ~7-11% (was ~28%); `small` keeps the simple `lines` layout as the fast correctness
  confirmation. medium/large are 48x32 over 120k ticks and 72x40 over 150k ticks, and
  every crafting stage is verified to reach a sink (copper-cable, iron-gear, circuit),
  so a jammed-but-periodic engine cannot pass as correct.
- **Every bus source shares one small harmonic period** (`BUS_PERIOD = 4`), which
  keeps the factory's steady-state cycle short so the transport reference — which
  fast-forwards across the detected cycle — stays cheap even through the three-stage
  copper chain (fuel: naive 81B / transport 1.58B on medium, naive 178B / transport
  2.76B on large — a ~50-65x gap, naive over the 5B ceiling, transport well under it).
- **Two smoke tests added — a belt `curve` (a run turning a perpendicular corner)
  and a `craft-chain` (one assembler's output feeding the next).** The scored bus
  factories rely on both behaviors, so each now has an isolated millisecond gate in
  the correctness pre-flight, and matching (distinct) training scenarios were added
  under `references/training/` so the model can practice them.

Rule corrections (all reference outputs and checksums regenerated):

- **The inserter's empty return takes real time.** After a drop the arm now swings
  back over `SWING` ticks (a new `return` phase) before it can grab again, instead
  of the return being instant. A full pick-and-place cycle is `SWING` out + `SWING`
  back, so an inserter no longer teleports back between deliveries — the engine
  respects the return the same way it respects the loaded swing.
- **The splitter is a Factorio-style, lane-preserving, per-type balancer.** It
  processes every input lane with an item at the edge on the same tick (both lanes of
  both input belts), so items arriving side by side move together. Two rules then
  place each item: the **input lane is preserved** (a left-lane item stays on a left
  lane, a right-lane item on a right lane — the splitter moves items across belts,
  never across lanes), and the **output belt alternates per item type** (each type
  remembers which belt its next item prefers and flips after routing one). So two full
  input belts of different items — iron on top, copper on bottom — split so **each
  output belt gets one iron and one copper**, not one belt all iron and the other all
  copper. Retained state is now a per-type preference cursor (`next_belt`) instead of
  the two round-robin cursors.
- **All belts move at one uniform speed, and inserters match it.** Belt speed is no
  longer per-tier — every belt runs at a single `SPEED` (`64` units/tick); a belt's
  `tier` is accepted for compatibility but is cosmetic. `SWING` is now tied to that
  speed (`2 × TILE / SPEED = 8` ticks) so an item moves at the same linear speed
  whether it rides a belt or is carried by an inserter. Recipe craft times are
  unchanged.
- **Inserters wait empty until their target can accept.** An idle inserter now peeks
  the item it would pick up and only grabs it when the drop target can take it right
  now; otherwise it waits with empty claws instead of grabbing and stalling with the
  item held over a full target. A lone inserter therefore never hovers holding an
  item — that happens only in the two-inserter race (both peek room, both grab, one
  deposits and the other holds). This also lets an inserter play its empty return
  swing between deliveries instead of snapping back.
- **Forcing onto a lane admits a gap of exactly `SPACING`.** The bound was
  strictly larger than `SPACING`, which made the standard entry coordinate
  (`TILE - SPACING`) unreachable on a compacted lane — the item ahead sits
  exactly `SPACING` away, so every force was refused. A saturated belt therefore
  capped at three items per tile with the last slot permanently empty. Belts now
  pack the full four per tile per lane.
- **One kind of inserter.** The `base`/`fast` inserter tiers are gone, replaced by
  a single `SWING`. A tier only means something when there is more than one
  inserter entity to choose between; with one entity it just made otherwise
  identical inserters run at visibly different rates. An inserter entity no longer
  takes a `tier` field.
- **Belt movement is defined over a run, not a tile.** A maximal chain of
  collinear same-direction belts now advances as **one long lane**, matching the
  "rigid block / transport-line" property the spec and architecture doc always
  described. Two things follow that the old per-tile hand-off got wrong: (a) a
  packed line reads as **frozen** and shifts as a single block when its front is
  consumed — the freed slot appears only at the run's very back, instead of a hole
  propagating backward one tile per tick; and (b) an item crosses a tile seam by an
  ordinary `SPEED`-step, so items no longer skip forward at every boundary or
  outrun their belt. Perpendicular curves and side-loads remain one-item-per-tick
  forced merges between runs. (Regenerates all checksums.)

Engine behavior corrected from playback review (oracles regenerated):

- **Splitters are item-agnostic.** A splitter no longer tracks an alternation cursor
  per item type; it keeps one cursor **per lane** and routes every item the same,
  balancing each input lane across the *corresponding* lane of the available output
  belts — never a belt's two lanes against each other. `out_pref` is now a per-lane,
  item-agnostic bitfield (only its two low bits are used; the `u16` byte layout is
  unchanged). `rules.md`, `canonical-state.md`, `contract.md`, and the state schema
  were updated to match. Note this drops the old per-type guarantee that each output
  belt receives one of every item type each tick — balancing is now by **count**, so a
  single tick may hand one output a row of one item and the other a row of another,
  evening out over time.
- **Inserter closer-item priority: already correct, no change.** A review flagged
  inserters seeming to grab the far lane, but the engine already takes the physically
  closer lane first and reaches across only when it is empty. The confusion is in the
  naming: `near_far_lanes` labels lanes by the inserter's *facing*, and an inserter
  picks from *behind* itself, so the lane it calls `far` is the one physically closer —
  which the pickup already tries first. The `rules.md`/docs wording now spells this out;
  the behavior (and the oracle) is unchanged.
- **Sink playback fix (no engine/oracle change).** Items consumed at a sink now glide
  into it during playback interpolation instead of freezing one step short and popping;
  the engine already consumed them the tick they reached the edge, so this is purely a
  renderer change.

(Only the splitter change alters the canonical state, so `cases/*.out` and every
`references/training/*/expected.json` were re-solved against the current engine.)

Machines, tiered belt speeds, and a main-bus redesign (everything regenerated):

- **The factory builds machines, in a dependency tree.** Three machine recipes were
  added — `transport-belt` (`iron-plate` + `iron-gear`), `inserter` (`iron-gear` +
  `circuit`), and `assembler` (**`transport-belt` ×2 + `circuit`**, a machine built
  from another machine) — and nine machine item ids appended to the item table
  (indices 7–15: a belt, an assembler, and an inserter, each in three tiers), fixing
  the renderer's item-sheet indices as the higher tiers gain recipes. Every craft cost
  divides `LCM(32, 64, 96) = 192`. Appending items does not change any *existing*
  checksum (the seven original items keep indices 0–6).
- **Belt tiers now move at different speeds.** `slow`/`fast`/`express` resolve to
  `32`/`64`/`96` units/tick (the 1×/2×/3× progression), and speed is **per tile**, so a
  higher-tier belt genuinely carries items faster and a mixed-tier line moves at mixed
  rates. The inserter swing stays tied to the `fast` reference (`SWING = 8`).
  `rules.md`, `prototypes.md`, and the overview doc were updated. **This moves every
  checksum**, so `cases/small.out` and the affected `references/training/*/expected.json`
  were all re-solved.
- **The `bus` layout is a real main bus.** The old long-backbone units (a source
  flooding one belt three-quarters across the grid into a machinery cluster at the far
  edge) are gone. Now: raw ore is emitted on the far-west column and rerouted by
  splitters into plate smelters that consume it all within the LEFT half; iron- and
  copper-plate **sub-bus lanes** run east across the whole grid, LINED with gear and
  cable stations tapping them; and a machine works builds circuit → transport-belt →
  inserter → assembler. Machinery spans the full width (not clustered), every product
  drains to its own single-item sink, and belts of all three tiers are used. `medium`
  (48×32, **300k** ticks, seed `0x2A01`) and `large` (72×40, **360k** ticks, seed
  `0x7E44`) were regenerated and re-solved, and all three machines are verified to reach
  a sink in both.
- **Fuel ceiling raised to `40_000_000_000`.** The realistic main bus has a large
  one-time WARM-UP (sub-bus lanes and splitter balancers reach equilibrium slowly), so
  the transport reference now costs ~17B (medium) / ~24B (large) — almost all fixed
  warm-up that barely grows with ticks. The scored scenarios therefore run long (300k /
  360k) so the naive engine (which pays per tick) balloons to ~142B / ~242B: a healthy
  ~8–10× gap, transport under the new 40B ceiling and naive well over it. The
  per-case `fuel_runway` multipliers are unchanged (they scale with the ceiling).

Factory configurations and real splitter use (medium/large regenerated):

- **Splitters now do real work.** Every splitter in a bus scenario is functional — it
  has two input belts or two output belts (or both): the plate sub-buses are routed by
  **1-in/2-out distribution splitters** (peel a share of a lane onto a branch), plus
  **2-in/2-out balancers** and **2-in/1-out merges**. The earlier layout's splitters
  were all inert 1-in/1-out no-ops; there are now **zero** of those (a test
  enforces it).
- **A configuration set is exercised.** The scored factories now contain, as *working*
  gadgets carrying real intermediates (never raw ore): belt **T-intersections**
  (side-loads), **double side-loads** (two belts onto one), **"+" intersections** (two
  feeders onto a through belt that continues), **two inserters sharing a starved belt**
  and **two inserters unloading one assembler** (both alternate, off a two-output
  recipe), **2-in/2-out** and **2-in/1-out** splitters, and a **mixed-item belt**
  (iron-plate + iron-gear on one lane feeding a `transport-belt` assembler). `large`
  carries all of these; `medium` carries the splitter plus several. Each is verified by
  a behavioral test (solved, not just placed). No engine change was needed — the
  simulation already modelled side-loads from both sides, full splitter balancing and
  merging, two inserters racing one source, and mixed lanes.
- **No raw ore is ever sunk.** Raw ore only feeds smelters; every sink consumes a
  smelted intermediate or a finished machine (a test enforces it). `medium` (seed
  `0x2A01`, 300k ticks) and `large` (seed `0x7E44`, 360k ticks) were regenerated and
  re-solved; the transport reference stays under the 40B ceiling (~23B / ~33B) and naive
  is far over it (~188B / ~342B).
