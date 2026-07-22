Introduced.

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
