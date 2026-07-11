# Junction — The city map: grid, terrain, zones, and development

This file defines the land the city grows on: the tile grid, the terrain under it, the
three zone kinds and how zoned tiles **develop themselves** through density tiers, how
they abandon, and the camera that views it. All positions and sizes are in the
logical-pixel coordinate system from `specs/overview.md` (a fixed `1280 x 720` stage;
the city view is `y` in `[64, 656]`, full width). It is built on by `specs/transit.md`
(the roads and rail laid across it), `specs/utilities.md` (the power and water carried
across it), and `specs/economy.md` (the demand and land value that decide what
develops).

## The grid

The city is a **top-down grid of square tiles**, seen from directly above. Every
position in the world snaps to this grid; the simulation reasons in tile coordinates
and only renders in pixels.

- A tile is **24 x 24** logical pixels.
- The map is a bounded rectangle of tiles — **96 columns wide** and **72 rows
  deep**, **larger than the city view**
  so there is a map to grow across and pan over. Tile `(0, 0)` is the top-left of the
  map.
- The map's outer edge is a hard border the city cannot build past; there is no
  building or scrolling out of the map.

## Terrain

Under everything is the **terrain**, fixed at the start of a game (the starting map is
defined in `specs/mode.md`). Each tile has one terrain kind that governs whether it can
be built on and what it costs:

- **Buildable land** — bare earth and grass (`specs/overview.md`), the ordinary ground
  the city zones and builds on.
- **Water** — rivers, lakes, coast. **Not** zoneable or directly buildable. Transit
  and utilities can only cross it with a bridge/tunnel span at extra cost
  (`specs/transit.md`, `specs/utilities.md`); it also serves as a water source for the
  utility network (`specs/utilities.md`) and raises the land value of adjacent tiles
  (an amenity; `specs/economy.md`).
- **Hills / rock** — raised, unbuildable rises. **Not** zoneable; crossing them with
  roads, rail, or utilities costs more (grading/tunneling), so they fragment cheap,
  connected land.

Terrain is **not** editable by the player in this version (no terraforming) — the
player works with the land they are given (`specs/mode.md`).

## Zones

The player never places a building directly. Instead the player **zones** buildable
land, and the simulation develops it. There are exactly three zone kinds, from
`specs/overview.md`:

- **Residential (R)** — where citizens live. Develops into housing.
- **Commercial (C)** — shops and offices. Develops into retail/commercial buildings
  and provides jobs and places to shop.
- **Industrial (I)** — factories and works. Develops into industry, provides the most
  jobs and the goods the commercial zones sell — and is the city's main source of
  **pollution** (`specs/economy.md`).

Zoning is painted on with the **zone tools** (`specs/controls.md`): the player marks
buildable tiles with a zone kind, and can re-zone or clear a tile. A zoned-but-empty
tile shows its zone color as a marked, undeveloped lot; only when it develops does a
building appear on it. Zoning itself is cheap or free (your choice; state it in the
`README`) — the money is spent on the transit and utilities that make a zone worth
developing, and on the ongoing budget (`specs/economy.md`).

## Development

A zoned tile **develops on its own** when it is worth building on, and grows through
**density tiers** as the city can support more. This self-development is the core of
the map system.

- **Preconditions.** A zoned tile develops only when it is **connected and served**:
  it must have **road access** (adjacent to, or a short walk from, the road network,
  `specs/transit.md`) and be reached by **power and water** (`specs/utilities.md`), and
  there must be **demand** for that zone kind (`specs/economy.md`). A tile missing any
  of these stays an empty lot until it gets them.
- **Density tiers.** A developed tile has a **density tier** — at least **three**
  (e.g. low / medium / high): a low-density lot holds a small building, and as demand,
  land value, and services rise the tile **upgrades** to a denser, taller-reading, more
  populous/productive building. Each tier houses more people or provides more jobs than
  the one below. The tier is visible: a high-tier tile reads as a bigger, denser
  building than a low-tier one (`specs/assets.md` — the produced sprites carry the
  tiers).
- **What drives the tier.** A tile develops and upgrades toward the tier its
  conditions support: strong demand, good **land value** (high near amenities and good
  service, low near pollution and congestion — `specs/economy.md`), reliable utilities,
  and good transit access push it up; losing any of those holds it down or pushes it
  back down.
- **Abandonment.** Development is **not permanent**. A developed tile that loses its
  preconditions — its road is bulldozed, its power or water is cut, its land value
  collapses under pollution, or demand for its kind dries up — **dilapidates and
  abandons**: it downgrades over time and eventually reverts to an empty (or derelict)
  lot, its population or jobs gone. A city that stops maintaining its networks watches
  its neighborhoods empty out.

Develop and abandon **gradually**, over simulation time, not instantly — the player
should see a neighborhood filling in as it is connected and served, and see it empty
out when it is neglected. A building going up shows **construction dust**
(`specs/assets.md`).

## Pollution and land value on the map

Two fields color the map and drive development; they are defined in full in
`specs/economy.md` and summarized here because they live on the tiles:

- **Pollution** spreads outward from industry and heavy traffic onto nearby tiles and
  decays with distance and over time. It is shown as a **produced particle haze**
  overlay (`specs/assets.md`) driven by the tile pollution field, and as a
  toggle overlay (`specs/controls.md`).
- **Land value** is a per-tile quality: high near water, parks, good services, and good
  transit; low near pollution, congestion, and unserved edges. It gates how high a tile
  develops (`specs/economy.md`) and can be shown as a toggle overlay
  (`specs/controls.md`).

## The camera

The map is larger than the city view (`y` in `[64, 656]`), so the city view is a
**camera** onto it:

- The player **pans** the camera across the map (`specs/controls.md`). The camera is
  clamped to the map bounds, so it never scrolls past the edges — at an edge, the map
  border sits flush against the view edge.
- The camera shows an integer-aligned region of tiles scaled to the city view; a tile
  is drawn at a consistent on-screen size (a modest zoom is acceptable but not
  required). The two HUD strips are never covered by the map — only the city view
  region `y` in `[64, 656]` shows tiles.
- On load, the camera is centered on the **starting area** (near where the city
  begins) so the player sees the buildable land and any pre-placed starting road
  immediately, before any input (`specs/mode.md`).
