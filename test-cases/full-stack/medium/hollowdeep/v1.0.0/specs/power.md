# Hollowdeep — The power network: generators, wires, and machines

This file defines power and the machines it runs. Power is generated, carried along
wires to machines, and rationed when demand outruns supply. It builds on the tile
world in `specs/world.md`, feeds the gas simulation in `specs/gas.md` (the machines
that make and move air), and is built through the economy in `specs/economy.md`.

## The network

Power is a **per-tile network** laid across the world:

- **Wires** are a built tile (`specs/economy.md`) that **carry power**. Two wires
  that share an edge are connected, and a machine or generator on a tile **adjacent
  to** (or on) a wire is attached to that wire's network. A maximal set of
  edge-connected wires (with the generators and machines attached to it) is one
  **power network**; the world may have several independent networks.
- Power does **not** travel through solid tiles, open space, or walls — only along
  wires. Reaching a distant machine means running a wire to it.

## Supply and demand

Each network balances **supply** against **demand** on the fixed simulation tick
(`specs/controls.md`):

- **Generators** add **supply** to their network. A generator produces a fixed
  wattage while it is running. At least one generator kind — a **coal (or manual)
  generator** — is required: it produces power while it has fuel to burn or a delver
  operating it (your choice; state it in the `README`), and stops when the fuel or
  the operator runs out. (An operated generator is a delver **job**,
  `specs/delvers.md`.)
- **Machines** add **demand**: each draws a fixed wattage while running.
- **Brownout.** If a network's total demand **exceeds** its supply, the network is
  **over-drawn** and **browns out**: it cannot power everything, so machines on it
  **stop** (all of them, or lowest-priority-first — your choice, but the effect must
  be visible) until demand falls back within supply or more generation is added. A
  browned-out oxygen diffuser stops making air, which is felt immediately in the gas
  economy. The HUD shows each network's supply and demand and flags a brownout
  (`specs/flow.md`).

## The machines

At least these two machines exist; you may add more (state any additions in the
`README`). Each occupies a tile, must be **attached to a powered network**, and does
nothing while unpowered or browned out.

- **Oxygen diffuser** — the colony's oxygen source. While powered, it **emits
  oxygen** into its open surroundings each tick (adding oxygen to its tile / adjacent
  open tiles in the gas simulation, `specs/gas.md`). It may consume a feedstock to do
  so — raw ore, or a dedicated resource you define — so that oxygen is not free; if
  you require a feedstock, state it in the `README` and show its stock in the HUD.
  This machine is what lets the colony outlast its starting air.
- **Pump** — moves gas. A pump **draws gas from one side and expels it to another**
  (for example pulling CO2 out of a low tunnel and pushing it into a distant vent
  chamber, or moving oxygen into a dead-end room diffusion cannot reach). It is how
  the player fights the buoyancy pooling in `specs/gas.md`. Define its exact intake
  and output clearly and show it doing so.

A machine plays its **steam/exhaust** particle effect while running (`specs/assets.md`)
and may have a soft machine sound (`specs/assets.md`), so a powered, working machine
is visibly and audibly distinct from a dead one.

## Building and placement

Generators, wires, and machines are **build orders** the player places and delvers
construct from material, exactly like the other buildings — see `specs/economy.md`
for the build flow, and `specs/controls.md` for placing them. A machine placed on a
network with no spare supply will brown the network out until more generation is
added, so growing the colony means growing its power alongside its air.
