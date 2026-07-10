# Junction — The transit network: roads, rail, flow, and congestion (signature)

This file defines the signature system of Junction: how the city moves. Roads and a
rail/metro line form a **network** that citizens and goods **path across** from where
they live to where they work and shop; links that carry more traffic than they can
handle **congest**, slowing every trip across them. **Read this file carefully.** It
builds on the tile map in `specs/map.md`, connects the zones developed there, feeds the
demand economy in `specs/economy.md` (access and travel time shape what develops), and
is one of the two ongoing costs on the budget (`specs/economy.md`).

## The network

Transit is a **per-tile network** laid across the map:

- **Roads** are a built tile that carry traffic. Two roads that share an edge are
  connected; a maximal set of edge-connected roads is one **road network**. Roads are
  laid with the road tool (`specs/controls.md`), one tile or a dragged run at a time,
  and cost money to build (`specs/economy.md`). Roads may cross **water** or **hills**
  only as a **bridge/tunnel** span at extra cost (`specs/map.md`).
- **Rail / metro** is a second, separate kind of link with its own tiles and its own
  **stations** (below): a higher-capacity line that moves many citizens along a
  corridor without loading the roads. A city needs **at least one** rail/metro line
  with stations.
- **Access.** A zoned tile has **road access** when it is adjacent to (or within a
  short, tunable walking distance of) the road network. Access is a precondition for
  development (`specs/map.md`): unreached land never develops, so extending roads into
  new land is how the city expands.

## Stations and how rail is used

Rail moves people only through **stations**:

- A **station/stop** is a built tile placed on the rail line, adjacent to (or on) the
  road network so citizens can reach it on foot/road. A trip can **ride the rail**
  between two stations on the same line instead of driving the whole way: the citizen
  travels road → origin station → along the rail → destination station → road.
- Riding rail is **faster and higher-capacity** than the equivalent road trip and does
  **not** load the roads along the rail corridor, so a well-placed line **relieves**
  the roads it parallels. The observable payoff the reviewer looks for: a congested
  road corridor **eases** when a rail line with stations is built along it and citizens
  shift onto it.
- Keep the rail model as simple as it needs to be — you need not simulate individual
  trains on a timetable (though animated trains/cars are welcome, `specs/assets.md`).
  What matters is that rail is a **distinct, higher-capacity path** the flow uses, with
  stations as its access points, and that it visibly offloads the roads.

## Trips: who travels, and pathing

The city's movement is a set of **trips** between developed tiles, run on the fixed
simulation tick (`specs/controls.md`):

- **Who travels.** Residential tiles generate citizens who need to reach **jobs**
  (commercial and industrial tiles) and **shops** (commercial tiles); industry ships
  **goods** to commercial tiles. You may model this as discrete agents (cars/citizens
  that visibly move) or as aggregate flow assigned onto links — **either is
  acceptable**, but the load on each link and the resulting congestion must be **real
  and computed**, not a decorative animation. Visible moving vehicles on the busy roads
  are strongly encouraged for legibility (`specs/assets.md`).
- **Pathing.** Each trip takes a path across the connected network from origin to
  destination — a route over roads, using rail between stations where that is faster.
  Use a real path search over the network graph (weighted by link travel time, which
  **rises with congestion**, below). A tile with no path to the jobs/shops it needs is
  effectively cut off, which holds its development down (`specs/map.md`,
  `specs/economy.md`).
- **Capacity.** Every link (a road tile, an intersection, a rail segment) has a
  **capacity** — how much traffic it can carry per tick at full speed. Roads are
  low-capacity; rail is high-capacity.

## Congestion — the flow pressure

This is the heart of the system, and where the *Mini Metro* flow-pressure lives:

- **Load vs. capacity.** Each tick, sum the traffic assigned to each link. A link
  whose load is **within** capacity flows at full speed. A link whose load **exceeds**
  capacity is **congested**: it cannot carry everything at once, so traffic on it
  **slows** — its effective travel time rises the more it is overloaded, and trips
  routed across it take longer.
- **It compounds.** Because travel time feeds back into pathing, a congested corridor
  pushes some trips onto alternates (spreading load) but also **lengthens** the trips
  that must use it — and long trips mean citizens spend more of their day commuting,
  which **caps growth** (an unreachable-in-time job is as good as no job;
  `specs/economy.md`). A city that grows faster than its roads gridlocks: everything
  slows, development stalls, and demand backs up.
- **It is shown.** Congestion is drawn on a **traffic overlay** (`specs/controls.md`,
  `specs/flow.md`): a link colors from clear through to **gridlock** (`#ff7a3c` →
  `#ff5a52`, `specs/overview.md`) as its load-over-capacity rises, so the player can see
  the jams and the corridors that need rail or widening. The overlay is drawn **in
  code** from the computed per-link load.
- **Relief.** The player relieves congestion by **building more/parallel roads**,
  **adding a rail line** with stations along the busy corridor to pull trips off the
  road, or **rezoning** to shorten commutes (putting jobs nearer homes). The
  interplay — grow the city, watch the roads load up, relieve them with rail and
  smarter layout — is the loop the game is built around.

## Building and cost

Roads, rail, and stations are placed with their tools (`specs/controls.md`) and cost
money to build (a per-tile capital cost, more for a bridge/tunnel span over water or
hills — `specs/map.md`, `specs/economy.md`). They also charge **ongoing upkeep** every
budget period (`specs/economy.md`): a sprawling network of lightly-used roads bleeds
the treasury, so the player must build enough transit to carry the city but not so much
that upkeep sinks it. Bulldozing a link (`specs/controls.md`) removes it — and can cut
off the tiles that depended on it, which then lose access and abandon (`specs/map.md`).
