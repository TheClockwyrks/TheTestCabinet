# Junction — The utility networks: power and water

This file defines the two utility networks the city runs on: **power** (generation
carried on wires) and **water** (sources carried on pipes). Supply is produced at a
source, propagates along its network, and reaches zones that can then develop; a zone
that is not reached — or a network that is over-drawn — stalls or abandons. It builds
on the tile map in `specs/map.md`, is a precondition for development there, and is the
other ongoing cost on the budget (`specs/economy.md`).

## Two networks, one pattern

Power and water are **two independent per-tile networks** that share the same shape,
so implement them from one mechanism with two carriers:

- **Power** is generated at a **power plant** and carried along **power lines
  (wires)**. Wires that share an edge are connected; a plant and the tiles it can
  serve are one **power network**.
- **Water** is drawn from a **water source** (a pump/tower on or beside a water tile,
  `specs/map.md`) and carried along **pipes**. Pipes that share an edge are connected;
  a source and the tiles it serves are one **water network**.

In both cases the carrier (wire / pipe) only conducts along its own tiles and to tiles
**adjacent to** the carrier — reaching distant land means running the line to it, just
like the roads (`specs/transit.md`). A carrier may cross water or hills only as a
span at extra cost (`specs/map.md`).

## Supply, demand, and reach

Each network balances **supply** against the **demand** of what it serves, on the fixed
simulation tick (`specs/controls.md`):

- **Sources add supply.** A power plant produces a fixed capacity of power; a water
  source produces a fixed capacity of water. Bigger or additional sources add more.
  (You may make a plant consume upkeep or a feedstock; keep it simple and state any
  such rule in the `README`.)
- **Developed tiles add demand.** Each developed tile draws power and water in
  proportion to its density tier (`specs/map.md`) — a high-tier tower draws more than a
  low-density lot.
- **Reach.** A tile is **served** by a utility when it is connected to a source-bearing
  network (adjacent to a wire/pipe that traces back to a plant/source with capacity to
  spare). A tile must be reached by **both power and water** to develop and to stay
  developed (`specs/map.md`).
- **Over-draw.** If a network's total demand **exceeds** its source capacity, it is
  **over-drawn** and cannot serve everything: some served tiles go **without** (all
  beyond capacity, or the farthest-from-source first — your choice, but the effect must
  be visible), which stalls or abandons them (`specs/map.md`) until capacity is added or
  demand falls. Growing the city means growing its power and water alongside it.

## What an unserved zone does

Utilities gate development directly (`specs/map.md`):

- A zoned tile that has road access and demand but is **not yet reached** by power and
  water stays an **empty lot** — it will not develop until the lines reach it. Running
  wires and pipes into newly-zoned land is part of opening it up, like running roads.
- A **developed** tile that **loses** power or water — its network over-draws, or its
  line is bulldozed — begins to **abandon** (`specs/map.md`): it dilapidates and empties
  out if the service is not restored. A blackout or a water cut visibly hollows out the
  affected district.

## The HUD reads the balance

The HUD (`specs/flow.md`) shows each utility's **supply vs. demand** across the city
and flags an **over-draw / shortfall** prominently (an alert, `specs/flow.md`), so the
player can see a network approaching its limit before districts start going dark. A
utility **overlay** (`specs/controls.md`) can show the served/unserved tiles and the
networks themselves.

## Building and cost

Plants, sources, wires, and pipes are placed with their tools (`specs/controls.md`) and
cost money to build (a per-tile capital cost; more for a plant/source, more for a span
over water or hills — `specs/map.md`, `specs/economy.md`). They charge **ongoing
upkeep** every budget period (`specs/economy.md`) — an over-provisioned grid of idle
capacity bleeds the treasury just as surplus roads do — so the player sizes the
utilities to the city. Keep the two networks simple and legible; they are supporting
systems to the transit-and-growth core, not a second signature simulation. Do **not**
add further utilities (garbage, sewage, etc.) — power and water are the two, done
clearly.
