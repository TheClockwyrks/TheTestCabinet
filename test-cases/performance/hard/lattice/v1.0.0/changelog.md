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
