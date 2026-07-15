# Upgrades — the five tracks, their tiers, and prices

This file defines the **Upgrade Shop** on the surface (`specs/world.md`): the five
upgrade tracks, what each tier gives, and what it costs in **Credits**
(`specs/flow.md`). Upgrades are the main thing Credits buy (the other is the rocket,
`specs/rocket.md`), and they are what gears the miner to dig deeper and survive
(`specs/character.md`, `specs/mining.md`). The numeric values here are **fixed**;
implement them exactly.

Each track has **five tiers**; you start at **tier 1** on every track and buy the next
tier in order (you cannot skip). The shop shows, per track, the current tier, what the
next tier gives, and its price, greying out a track that is maxed or unaffordable. A
purchase deducts the price immediately and applies at once (a bigger tank raises your
maximum fuel — you still buy the extra fuel itself at the Fuel Depot, `specs/flow.md`;
a stronger drill takes effect on the next dig).

## Fuel tank — how deep a round trip reaches

Sets the **maximum fuel** (`specs/character.md`). More fuel is more depth per trip,
because the climb back is what fuel is spent on.

| Tier | Max fuel | Price |
| --- | --- | --- |
| 1 | `100` | — (start) |
| 2 | `175` | `220` |
| 3 | `275` | `600` |
| 4 | `400` | `1400` |
| 5 | `550` | `3000` |

## Drill — how fast (and how deep) you can dig

Sets the drill **power** (`specs/character.md`), which divides into tile hardness to
give the **drill time** per tile. A tile whose band hardness exceeds the drill's power
still drills, but **slowly** — so the deep bands are a soft gate until you buy up.

| Tier | Power | Drill time by band hardness (seconds/tile) — H1 / H2 / H3 / H4 | Price |
| --- | --- | --- | --- |
| 1 | `1` | `0.5 / 1.4 / 3.2 / 6.0` | — (start) |
| 2 | `2` | `0.35 / 0.7 / 1.6 / 3.0` | `260` |
| 3 | `3` | `0.28 / 0.5 / 0.9 / 1.7` | `700` |
| 4 | `4` | `0.22 / 0.4 / 0.6 / 0.9` | `1600` |
| 5 | `5` | `0.18 / 0.32 / 0.45 / 0.6` | `3200` |

(H1 = topsoil, H2 = rockbed, H3 = deepstone, H4 = coreshell, `specs/world.md`. The
tier-1 drill takes six seconds a tile in the coreshell — passable but punishing — so
the coreshell is effectively reachable only with a mid-to-high drill.)

## Cargo bay — ore per trip

Sets the **cargo capacity** in ore units (`specs/mining.md`). A bigger bay is more
ore sold per surface trip, but a heavier climb.

| Tier | Capacity (units) | Price |
| --- | --- | --- |
| 1 | `15` | — (start) |
| 2 | `25` | `200` |
| 3 | `40` | `550` |
| 4 | `65` | `1300` |
| 5 | `100` | `2800` |

## Hull — surviving the deep

Sets the **maximum hull** (`specs/character.md`). More hull survives more gas blasts,
lava brushes, and hard landings — essential for the core run.

| Tier | Max hull | Price |
| --- | --- | --- |
| 1 | `100` | — (start) |
| 2 | `150` | `240` |
| 3 | `220` | `640` |
| 4 | `320` | `1500` |
| 5 | `450` | `3100` |

## Scanner — finding the materials

Sets the **scanner range** (`specs/mining.md`) — how far off the scanner locks onto
the nearest needed exotic material. A wider range means you home in from farther,
turning a blind search into a confident beeline.

| Tier | Range (tiles) | Price |
| --- | --- | --- |
| 1 | `6` | — (start) |
| 2 | `12` | `180` |
| 3 | `20` | `480` |
| 4 | `32` | `1000` |
| 5 | `48` (whole band) | `2000` |

## How the tracks pace the game

The prices climb so that the early game is a tight loop of small digs funding tier-2
buys, and each tier opens a little more depth (drill), range (scanner), safety (hull),
and reach (fuel + cargo). The two **material** runs (Resonite in the rockbed, Cryenite
in the deepstone) want a decent **scanner** and enough **fuel + drill** to get down
and back; the **core run** wants high **fuel**, **hull**, and **drill** to survive the
coreshell and beat the 90-second climb (`specs/hazards.md`). You will not max every
track before winning — the game is about spending Credits where each dig most needs
them, alongside fabricating the rocket (`specs/rocket.md`).
