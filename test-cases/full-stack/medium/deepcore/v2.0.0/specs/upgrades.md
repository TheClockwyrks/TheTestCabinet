# Deepcore — The upgrade tracks

This file defines the Upgrade Shop: the seven upgrade tracks, what each tier
gives, and what it costs. Every figure below carries the name this specification
gives it.

The seven tracks are `fuel`, `drill`, `cargo`, `hull`, `jetpack`, `radiator`, and
`scanner`. The shop sells these tracks and nothing else; the six single-use field
supplies are sold at the Supply Depot.

Every track starts at tier `1` and is bought one tier at a time in order. Six
tracks have five tiers; `scanner` has three. The shop shows each track's current
tier, what the next tier gives, and its price, and disables a track that is maxed
out or unaffordable.

A purchase deducts its price immediately and applies at once. A stronger drill
takes effect on the next cut. A bigger fuel tank or hull raises the maximum and
adds the same amount to the current value, so a `100` to `175` tank at `30/100`
fuel becomes `105/175`. It is not a refill: the rest is still bought at the Fuel
Depot.

## Prices

The six five-tier tracks share one price ladder, held in `UPGRADE_PRICES`:

| Step | Price |
| --- | --- |
| tier 1 to 2 | `300` |
| tier 2 to 3 | `750` |
| tier 3 to 4 | `1900` |
| tier 4 to 5 | `4100` |

`scanner` has two purchasable levels and takes the first two rungs of that ladder,
`300` then `750`.

## Fuel tank

Sets the maximum fuel.

| Tier | Max fuel |
| --- | --- |
| 1 | `100` |
| 2 | `175` |
| 3 | `275` |
| 4 | `400` |
| 5 | `550` |

## Drill

Sets the damage a drill hit removes from a cell's health. Hits land every
`DRILL_HIT_INTERVAL` (`0.125`) seconds and each spends `DRILL_HIT_FUEL` (`0.25`)
fuel, so the hits to break a cell are `ceil(BAND_HEALTH / damagePerHit)`, the time
is `hits * DRILL_HIT_INTERVAL`, and the fuel is `hits * DRILL_HIT_FUEL`. Damage
per hit may be fractional; health is a number and hits round up.

| Tier | Damage per hit | Topsoil hits | Rockbed hits | Deepstone hits | Coreshell hits |
| --- | --- | --- | --- | --- | --- |
| 1 | `1` | `4` | `8` | `12` | `16` |
| 2 | `1.5` | `3` | `6` | `8` | `11` |
| 3 | `2.5` | `2` | `4` | `5` | `7` |
| 4 | `3.5` | `2` | `3` | `4` | `5` |
| 5 | `5` | `1` | `2` | `3` | `4` |

The shop shows the drill's tier as a power rating from `1` to `5` rather than the
raw damage number.

## Cargo bay

Sets the cargo capacity in ore slots. Weight is a separate limit, set by the
jetpack.

| Tier | Capacity |
| --- | --- |
| 1 | `15` |
| 2 | `25` |
| 3 | `40` |
| 4 | `70` |
| 5 | `120` |

## Hull

Sets the maximum hull.

| Tier | Max hull |
| --- | --- |
| 1 | `100` |
| 2 | `150` |
| 3 | `220` |
| 4 | `320` |
| 5 | `450` |

## Jetpack

Sets three figures per tier: the heaviest load the jetpack can climb with, the
empty-load climb speed cap, and the empty-load climb acceleration.
How a load scales the last two is stated with the miner's movement.

| Tier | `liftLimitKg` | `emptyClimb` | `emptyAccel` |
| --- | --- | --- | --- |
| 1 | `350` | `950` | `1200` |
| 2 | `1100` | `1010` | `1270` |
| 3 | `2850` | `1080` | `1350` |
| 4 | `7400` | `1150` | `1440` |
| 5 | `12700` | `1230` | `1540` |

Every `emptyClimb` sits at or below `FALL_TERMINAL_EMPTY` (`950`), so a climb never
outruns an empty plunge.

## Radiator

Sets the fraction by which lava damage is reduced, both the contact drain and the
lump for drilling through a lava cell. It does not reduce gas damage.

| Tier | Effectiveness |
| --- | --- |
| 1 | `0` |
| 2 | `0.25` |
| 3 | `0.45` |
| 4 | `0.65` |
| 5 | `0.8` |

## Scanner

Sets the range at which the scanner locks onto a needed material node, in tiles.
Tier `1` is no scanner at all.

| Tier | Range |
| --- | --- |
| 1 | none |
| 2 | `10` tiles |
| 3 | `32` tiles |

Tier `2` reaches past the edge of the viewport, which is about `16` tiles wide.
Tier `3` covers the full width of the world, so the band's node locks from
anywhere across it once the miner is at its depth.
