Introduced.

Rule corrections (all reference outputs and checksums regenerated):

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
