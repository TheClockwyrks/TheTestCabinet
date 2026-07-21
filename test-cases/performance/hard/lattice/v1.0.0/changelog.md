Introduced.

Rule corrections (all reference outputs and checksums regenerated):

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
- **A splitter handles a same-tick pair without staggering.** The output-lane cursor
  now walks each output belt's two lanes consecutively (grouped by belt) rather than
  interleaving the belts, so two items moved on one tick land on one belt's two lanes
  at the same entry position and travel out aligned instead of zippering. The
  four-way balance (10 per belt, 5 per lane over 20) is unchanged.
- **Forcing onto a lane admits a gap of exactly `SPACING`.** The bound was
  strictly larger than `SPACING`, which made the standard entry coordinate
  (`TILE - SPACING`) unreachable on a compacted lane — the item ahead sits
  exactly `SPACING` away, so every force was refused. A saturated belt therefore
  capped at three items per tile with the last slot permanently empty. Belts now
  pack the full four per tile per lane.
- **Splitters balance lanes, not just belts.** An item's input lane used to be
  preserved, so a single-lane input came out on a single lane and the other two
  output lanes stayed empty. The output cursor now runs over all four output lanes
  (both lanes of both belts), so 20 items in becomes 10 per belt with 5 per lane.
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
