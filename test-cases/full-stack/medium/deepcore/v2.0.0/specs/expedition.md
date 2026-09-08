# Deepcore — The expedition, the economy, and saving

This file defines the expedition the game plays, the Credits economy, the surface
loop, saving and continuing, and the expedition summary. Every figure below carries the
name this specification gives it.

## The expedition

The game plays one expedition. Starting it is a two-step choice: the mode, then
the world size. Choosing a size begins the expedition at once.

The miner starts standing on the camp ground at `SPAWN_COL` (`4`), at tier `1` on
every upgrade track, with a full fuel tank and a full hull, `0` Credits, an empty
cargo bay, an empty satchel, no field supplies, and no rocket component installed.
The mine is generated fresh at the chosen size.

The expedition is the same in both modes and at every size. The mode governs only
what a death costs; the size governs only how deep the mine goes.

## Credits

Credits are the currency. There is one source and four sinks.

| Direction | Where        | What                                                          |
| --------- | ------------ | ------------------------------------------------------------- |
| Source    | Ore Market   | Selling the cargo at each ore's value, which empties the bay. |
| Sink      | Fuel Depot   | Buying fuel and hull repair.                                  |
| Sink      | Upgrade Shop | Buying the next tier on an upgrade track.                     |
| Sink      | Supply Depot | Buying a single-use field supply.                             |
| Sink      | Launch Pad   | Fabricating a rocket component.                               |

Credits never go negative, and an action that cannot be afforded is disabled.
Credits are banked: once earned they survive a death in either mode.

## The Fuel Depot

Fuel costs `FUEL_PRICE` (`1`) Credit per unit and hull repair costs `REPAIR_PRICE`
(`2`) Credits per point. The panel offers a fixed increment of
`FUEL_BUY_INCREMENT` (`25`) units and `REPAIR_BUY_INCREMENT` (`25`) points, and a
fill-to-full and repair-to-full that pay only for what is missing and only as far
as the Credits reach.

## The surface loop

Arriving at the surface refuels and repairs nothing: fuel and hull are exactly
what the miner climbed out with. The surface is where they are bought back.

The loop is: descend and fill the cargo bay, climb back before fuel or hull runs
out, sell, pay to refuel and repair, spend what is left on an upgrade or a rocket
component, and go again.

## Saving and continuing

- The Save Pad is the only way to save. There is no autosave and no saving
  underground. Activating the pad writes the save on the spot and shows a note
  confirming it, or one explaining why it was refused.
- There is one save slot, and saving overwrites it. Starting a new expedition
  abandons any existing save.
- A save holds the generated mine and its world size, the mode, banked Credits,
  every upgrade tier, the installed rocket components, the held field-supply
  counts, the cargo, the satchel's materials, and the miner's fuel and hull.
- Saving is refused while a Core Sample's timer runs, whether the Sample is
  carried or lying jettisoned, so the timer is never frozen out by saving and
  quitting. A live Core Sample is never carried in the save.
- Resuming a save restores the expedition exactly as it was saved and places the
  miner on the surface. `specs/ui.md` states the menu entries that resume one.
- A Hardcore death deletes the save. A victory consumes it. A Standard death
  leaves it intact.

The save is held in the browser. The game runs correctly when that storage is
unavailable, simply without saving. It is the only persisted state; everything
else is per-session.

## The expedition summary

The game keeps no running total. The Victory and Game Over screens summarize the
expedition: the deepest depth reached in meters, the total Credits earned, the
elapsed time, the mode, the number of rocket components installed, and, on a Game
Over, how the miner died. The summary is not persisted.

The elapsed time is the expedition's own clock. It reads `0` before an expedition
begins, is set back to `0` when one begins, and accumulates game time while the
miner is in the mine, so time spent on the pause menu, on a menu screen, or on a
summary screen does not count toward it. The summary reports the value the clock
held when the expedition ended.
