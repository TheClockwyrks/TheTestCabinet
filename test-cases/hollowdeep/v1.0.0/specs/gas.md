# Hollowdeep — The gas simulation: oxygen, CO2, and suffocation (signature)

This file defines the signature system of Hollowdeep: the air. Open tiles hold two
gases — breathable **oxygen** and waste **CO2** — that diffuse through the connected
open space, settle by weight, are consumed and exhaled by the delvers, and decide
whether the colony lives. **Read this file carefully.** It builds on the tile world
in `specs/world.md`, is produced against by the machines in `specs/power.md`, and
drives the delvers' oxygen need in `specs/delvers.md` and the survival pressure in
`specs/flow.md`.

## Where gas lives

Gas lives in **open tiles** — dug or naturally hollow space, and the built tiles
that do not block air (floors, ladders, wires, and open machine tiles;
`specs/world.md`). Each such tile holds an amount of **oxygen** and an amount of
**CO2**, each a non-negative quantity up to a per-tile **capacity**. Solid natural
tiles and walls hold no gas and **block** it: gas moves only between open tiles that
share an edge (4-connectivity — up, down, left, right; not diagonally).

- A tile's **pressure** is its total gas (oxygen + CO2); its **oxygen fraction** is
  oxygen over that total. Both matter: a delver needs enough oxygen *and* not too
  much CO2 (below).
- **Sealed pockets stay sealed.** Two open regions separated by solid tiles or walls
  do not exchange gas until a dig or an opening connects them. This is why digging
  redistributes the air (`specs/world.md`) and why a wall can hold good air in one
  room while another sours.

## Diffusion

Run the gas on the **fixed simulation tick** (`specs/controls.md`), not the render
frame. Each tick, gas moves toward evening out across connected open tiles:

- **Even out.** For each pair of edge-adjacent open tiles, move a **fraction** of
  the difference in each gas from the higher tile to the lower one, so concentrations
  tend toward equal over time without ever overshooting (a stable diffusion step —
  pick a fraction well under the point of oscillation). Oxygen and CO2 diffuse
  independently.
- **Conserve gas.** Diffusion only **moves** gas between tiles; it neither creates
  nor destroys it. The only sources and sinks are the delvers (breathing, below) and
  the machines (`specs/power.md`) — the total in a sealed region changes only through
  those.
- **Capacity.** A tile cannot exceed its capacity; excess simply stays in the
  neighbor. You need not model realistic over-pressure — a soft cap is enough.

## Buoyancy

The two gases are **not** the same weight, and the cross-section shows it:

- **CO2 sinks, oxygen rises.** In addition to plain diffusion, bias vertical
  transfer by weight: CO2 is drawn **downward** into the tile below it, and oxygen is
  drawn **upward** into the tile above it, a little each tick, so — left undisturbed
  — CO2 pools in the low tunnels and the floor of a room while the breathable oxygen
  collects up near the ceiling. Horizontal transfer stays plain diffusion.
- This makes vertical layout matter: a deep dead-end tunnel fills with the CO2 the
  delvers exhale and becomes a suffocation trap, while air near the top stays
  breathable longer. Pumps and diffusers (`specs/power.md`) exist to fight this.

Keep buoyancy gentle relative to diffusion — it biases where gas settles, it does not
teleport it. The observable result the reviewer looks for is that CO2 visibly
**collects low** and oxygen **sits higher**, not a specific transfer rate.

## The delvers breathe

Delvers are the colony's oxygen sink and CO2 source (`specs/delvers.md`):

- Each tick a delver in an open tile **consumes oxygen** from its current tile and
  **exhales CO2** into it, at a steady rate. Many delvers in a small room draw its
  oxygen down and load it with CO2 faster than diffusion can refill it.
- **Suffocation.** A delver whose tile's oxygen has fallen **below a breathable
  threshold**, or whose CO2 has risen **above a toxic threshold**, cannot breathe:
  it takes **suffocation damage** to its health each tick it stays there. A delver
  restored to breathable air recovers. A delver whose health reaches zero from
  suffocation **dies** (`specs/delvers.md`, `specs/flow.md`). Delvers will try to
  flee toward better air as a survival job (`specs/delvers.md`), but if there is
  none, they die — this is the colony's core failure mode.
- A delver standing in a tile with **no** open air at all (it was walled in, or the
  pocket is spent) suffocates fastest.

## The gas overlay

The gases are shown as a **live overlay** on the colony view, so the player can read
the air at a glance:

- **Oxygen** is drawn as a fine, **rising haze** in the oxygen color
  (`specs/overview.md`), denser where oxygen is more concentrated. **CO2** is drawn
  as a heavier plume in the CO2 color that **settles into the low tunnels**, denser
  where CO2 pools. Together they show the buoyancy: breathable air up high, waste
  gathering low.
- **These overlays are produced particle effects.** The oxygen haze and the CO2 plume
  are `particle-2d` systems you authored and **play live through
  `@test-cabinet/particle-runtime`**, their intensity and placement **driven by the
  tile concentrations** — you spawn/scale the effect where a gas is present and how
  much. They are not a flat colored fill and not a hand-coded shader. `specs/assets.md`
  is the contract for producing and playing them.
- The overlay must stay legible over the tiles beneath it: a player should be able to
  see a room going stale (oxygen haze thinning, CO2 plume rising) before a delver is
  in danger, and should be able to tell breathable air from waste by form as well as
  color (`specs/overview.md`).

## The starting air

The colony begins with a **finite pocket** of breathable oxygen filling its opening
cavern and little to no CO2 — enough to live on for a while, not forever
(`specs/flow.md` states the survival pressure this creates). There is **no** ambient
air seeping in from the sealed rock: the only ways to add oxygen are the machines you
build (`specs/power.md`), and the only ways to clear CO2 are to pump or vent it or to
give it somewhere to diffuse. From the first cycle the total breathable air is a
resource the colony spends by breathing and must learn to replace.
