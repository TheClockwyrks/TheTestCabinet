# Upgrades: the seven tracks, their tiers, and prices

This file defines the Upgrade Shop on the surface (`specs/world.md`): the seven upgrade
tracks, what each tier gives, and what it costs in Credits (`specs/flow.md`). Upgrades
are the main thing Credits buy (the other is the rocket, `specs/rocket.md`), and they
are what gears the miner to dig deeper, haul more, and survive (`specs/character.md`,
`specs/mining.md`). The numeric values here are fixed; implement them exactly.

The seven tracks are fuel tank, drill, cargo bay, hull, jetpack, radiator, and scanner.

The Upgrade Shop sells only these seven tracks. The six single-use field supply items
are sold at a separate building, the Supply Depot (`specs/items.md`, `specs/world.md`);
they are single-use consumables (bought with Credits and carried as a count, not
permanent tiers), specified in full in `specs/items.md`, not here. This file is the
authority for the seven upgrade tracks.

Each track has five tiers; you start at tier 1 on every track and buy the next tier in
order (you cannot skip). The shop shows, per track, the current tier, what the next tier
gives, and its price, greying out a track that is maxed or unaffordable. A purchase
deducts the price immediately and applies at once: a stronger drill takes effect on the
next dig; a bigger fuel tank or hull raises the maximum and grants the added capacity as
usable fuel/hull right then. Buying a `100 → 175` tank at `30/100` fuel makes it
`105/175` (the `+75` of new capacity is filled in immediately), but it is not a free
top-up to full; you still buy the rest of the fuel at the Fuel Depot
(`specs/character.md`, `specs/flow.md`).

## Prices: a tier is a layer

The four purchasable steps on every track are priced so that each tier roughly
corresponds to a depth band, costing about five units of that band's signature ore
(`specs/mining.md`), so the band you dig to fund a tier is the band that tier gears you
for. Ore values are fixed (`specs/mining.md`); the anchor is `5 × signature-ore value`:

| Step | Funding band (signature ore) | `5 × value` | Price |
| --- | --- | --- | --- |
| tier 1 → 2 | Topsoil (Cuprite `65`) | `~325` | `300` |
| tier 2 → 3 | Rockbed (Argenite `150`) | `750` | `750` |
| tier 3 → 4 | Deepstone (Voltite `380`) | `1900` | `1900` |
| tier 4 → 5 | Coreshell (Pyronium `820`) | `4100` | `4100` |

All seven tracks share this ladder (`— / 300 / 750 / 1900 / 4100`, tier 1 being the free
start), so at any given tier every track costs about the same "five ores of the layer you
are in". This keeps every per-track price table below identical; the tables still list the
price per tier for reference.

## Fuel tank: how deep a round trip reaches

Sets the maximum fuel (`specs/character.md`). More fuel is more depth per trip, because
the climb back is what fuel is spent on. Buying a bigger tank adds the capacity increase
to your current fuel immediately (a `100 → 175` tank at `30/100` becomes `105/175`), not
a free fill to full; you still buy the rest at the Fuel Depot.

| Tier | Max fuel | Price |
| --- | --- | --- |
| 1 | `100` | — (start) |
| 2 | `175` | `300` |
| 3 | `275` | `750` |
| 4 | `400` | `1900` |
| 5 | `550` | `4100` |

## Drill: damage per hit (and the fuel it costs)

Every minable tile has health set by its band's hardness (`specs/world.md`,
`specs/character.md`): topsoil `4` / rockbed `8` / deepstone `12` / coreshell `16`. The
drill deals damage per hit, and hits land on a fixed cadence (`0.125 s` per hit); each
hit spends `0.25` fuel. The number of hits to break a tile is `ceil(tileHealth /
damagePerHit)`, so the time to drill a tile is `hits × 0.125 s` and the fuel it costs is
`hits × 0.25`. Two consequences fall out of this and are the point of the model:

- Harder soil costs more fuel, not just more time. A deeper band has more health, so more
  hits, so more fuel: a coreshell tile costs the tier-1 drill four times the fuel of a
  topsoil tile, so a deep dig that has not bought up the drill bleeds fuel as it goes.
- A stronger drill cuts both the fuel and the time. More damage per hit means fewer hits,
  which lowers both the seconds and the fuel for a given band, so buying up the drill is
  what makes the deep bands dig at a workable pace and a bearable fuel cost.

The drill's damage per hit by tier, and the resulting hits / time / fuel per tile in each
band (H1 = topsoil `4` hp, H2 = rockbed `8`, H3 = deepstone `12`, H4 = coreshell `16`):

The damage curve is `1 / 1.5 / 2.5 / 3.5 / 5`: the two endpoints are pinned (`1` and `5`)
but the middle steps are deliberately sub-doubling rather than a flat `1/2/3/4/5`, so
buying one drill tier does not trivialize the layer above it. A band only turns
near-trivial roughly two tiers past the one it is matched to. Fractional damage is fine;
health is a number and hits round up.

| Tier | Damage/hit | H1 hits · s · fuel | H2 hits · s · fuel | H3 hits · s · fuel | H4 hits · s · fuel | Price |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `1` | `4 · 0.50 · 1.00` | `8 · 1.00 · 2.00` | `12 · 1.50 · 3.00` | `16 · 2.00 · 4.00` | — (start) |
| 2 | `1.5` | `3 · 0.375 · 0.75` | `6 · 0.75 · 1.50` | `8 · 1.00 · 2.00` | `11 · 1.375 · 2.75` | `300` |
| 3 | `2.5` | `2 · 0.25 · 0.50` | `4 · 0.50 · 1.00` | `5 · 0.625 · 1.25` | `7 · 0.875 · 1.75` | `750` |
| 4 | `3.5` | `2 · 0.25 · 0.50` | `3 · 0.375 · 0.75` | `4 · 0.50 · 1.00` | `5 · 0.625 · 1.25` | `1900` |
| 5 | `5` | `1 · 0.125 · 0.25` | `2 · 0.25 · 0.50` | `3 · 0.375 · 0.75` | `4 · 0.50 · 1.00` | `4100` |

A topsoil tile at the tier-1 drill is exactly `1.0` fuel, so the top of the mine is not
made harder. The coreshell at tier 1 is `4.0` fuel a tile (a soft gate on fuel as much as
on time); by tier 5 it is back to `1.0`. The shop shows the drill's tier as a plain power
rating `1..5`, not the raw damage number. Damage persists on the tile: drill a tile
partway and move away and it keeps its accrued damage, resuming continues from where it
left off, and the fuel already spent is not refunded (`specs/character.md`).

## Cargo bay: how many ore you can haul per trip

Sets the cargo capacity as a number of ore slots (`specs/mining.md`): one unit of any ore
fills one slot, regardless of weight. A bigger bay is more ore sold per surface trip.
Weight is a separate limit: how heavy the haul is decides whether the jetpack can lift it
(`specs/character.md`), independent of the slot count.

| Tier | Capacity (ore slots) | Price |
| --- | --- | --- |
| 1 | `15` | — (start) |
| 2 | `25` | `300` |
| 3 | `40` | `750` |
| 4 | `70` | `1900` |
| 5 | `120` | `4100` |

## Hull: surviving the deep

Sets the maximum hull (`specs/character.md`). More hull survives more gas blasts, lava
brushes, and hard landings, essential for the core run. Like the fuel tank, buying a
bigger hull adds the capacity increase to your current hull immediately (a `100 → 150`
hull at `40/100` becomes `90/150`), not a free repair to full; you still buy the rest of
the repair at the Fuel Depot.

| Tier | Max hull | Price |
| --- | --- | --- |
| 1 | `100` | — (start) |
| 2 | `150` | `300` |
| 3 | `220` | `750` |
| 4 | `320` | `1900` |
| 5 | `450` | `4100` |

## Jetpack (engine): lifting weight and climbing speed

Sets three independent numbers per tier: max cargo it can lift, the empty-load climb-speed
cap, and the empty-load climb acceleration (`specs/character.md`). A stronger jetpack
mainly lifts a heavier haul: as the cargo load fraction (weight ÷ max cargo) rises, the
climb acceleration falls linearly to zero at the limit and the top speed falls part-way
(to ~58% of the empty cap). The empty climb speed rises only gently across tiers on
purpose; a jetpack tier earns its keep by lifting more weight, not by flying ever faster
(the caps stay at or under the empty fall terminal so a climb never out-runs a plunge),
and the fuel savings come from cruising, not a bigger top speed (`specs/character.md`).

The Max cargo column is the heaviest ore weight that tier can still climb with (the `200
kg` suit is already folded into the empty-load figures); a haul heavier than this is
un-liftable until the jetpack is bought up or ore is dropped. The ladder is steep because
a full bay of a band's typical (median) ore should lift out at a matched engine at ~75–77%
speed on a sensible fuel budget, and both the cargo slot count (`15→120`) and the ore
weight (`14→58 kg`) compound with depth, so lift must grow to match. The tension shows up
in two places instead of on every haul: a greedy bay of a band's heaviest, richest ore
climbs slower (~67–72%) and can tip into overload, and a cargo bay bought ahead of the
engine overloads it (a tier-2 cargo bay of median topsoil ore already exceeds a tier-1
engine's lift).

| Tier | Max cargo (kg) | Empty climb (px/s) | Empty accel (px/s²) | Price |
| --- | --- | --- | --- | --- |
| 1 | `350` | `950` | `1200` | — (start) |
| 2 | `1100` | `1010` | `1270` | `300` |
| 3 | `2850` | `1080` | `1350` | `750` |
| 4 | `7400` | `1150` | `1440` | `1900` |
| 5 | `12700` | `1230` | `1540` | `4100` |

(Cargo is capped by slot count, not weight, so the jetpack's lift is what actually gates a
heavy haul: a bay full of light ore lifts on a low tier, but a bay of deep, heavy ore can
exceed it. Buy up the jetpack, or drop ore, to fly out, `specs/character.md`.)

## Radiator: surviving heat

Reduces gas-explosion and lava-contact damage by its effectiveness (`specs/hazards.md`,
`specs/character.md`). Tier 1 is bare stock plating (no reduction); because deep gas
scales sharply with depth and coreshell lava is dense, an upgraded radiator, alongside the
hull tier, is what makes the deep bands and the core run survivable. Effectiveness never
reaches 100%; the deep is always dangerous.

| Tier | Effectiveness | Price |
| --- | --- | --- |
| 1 | `0%` | — (start) |
| 2 | `25%` | `300` |
| 3 | `45%` | `750` |
| 4 | `65%` | `1900` |
| 5 | `80%` | `4100` |

## Scanner: finding the materials

Sets the scanner range (`specs/mining.md`): how far off the scanner locks onto the nearest
needed exotic material. A wider range means you home in from farther, turning a blind
search into a confident beeline.

| Tier | Range (tiles) | Price |
| --- | --- | --- |
| 1 | `6` | — (start) |
| 2 | `12` | `300` |
| 3 | `20` | `750` |
| 4 | `32` | `1900` |
| 5 | `48` (whole band) | `4100` |

## How the tracks pace the game

The prices climb on the layer ladder above (`— / 300 / 750 / 1900 / 4100`, shared by all
seven tracks): each purchasable tier costs about five units of the signature ore of the
band you dig to fund it (tier 1→2 ≈ five topsoil Cuprite, tier 4→5 ≈ five coreshell
Pyronium), so a tier is priced like a layer and the band you are digging is the band that
pays for the tier it gears you for. The early game is a tight loop of small topsoil digs
funding tier-2 buys; each tier opens a little more depth (drill), lift and haul (jetpack
and cargo), range (scanner), and survival (hull and radiator), while fuel sets how far a
round trip reaches, and a bigger fuel tank or hull hands you its new capacity on the spot
(`specs/character.md`). The cargo and jetpack tracks complement each other: a bigger bay
lets you carry more pieces, but the jetpack is what lets you lift a heavy haul out
(`specs/character.md`), so a deep, rich dig wants both (plus the option to drop ore,
`specs/mining.md`, when a haul turns out too heavy to fly). The two material runs (Resonite
in the rockbed, Cryenite in the deepstone) want a decent scanner and enough fuel and drill
to get down and back; the core run wants high fuel, hull, radiator, jetpack, and drill to
survive the coreshell's scaling gas and dense lava and beat the 90-second climb
(`specs/hazards.md`). You will not max every track before winning; the game is about
spending Credits where each dig most needs them, alongside fabricating the rocket
(`specs/rocket.md`).
