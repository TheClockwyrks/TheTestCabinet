# Gameplay: the expedition, the economy, the surface loop, saving, and scoring

This file defines the single expedition Deepcore plays, the Credits economy, the surface
loop, saving and continuing, and scoring. The game's state machine, the required menus,
the HUD, and what is out of scope now live in `specs/ui.md`. It refers to mining and
selling (`specs/mining.md`), upgrades (`specs/upgrades.md`), the rocket
(`specs/rocket.md`), the miner's fuel/hull/death (`specs/character.md`), the hazards
(`specs/hazards.md`), the modes (`specs/modes.md`), and the controls
(`specs/controls.md`). The numeric values here are fixed; implement them exactly.

## The expedition

This is the single expedition Deepcore plays, and its main-menu entry. It builds on the
mine (`specs/world.md`), the miner (`specs/character.md`), the rocket (`specs/rocket.md`),
and the two modes (`specs/modes.md`).

The title menu lists exactly one play action, `NEW EXPEDITION`, followed by HOW TO PLAY
(`specs/ui.md`, Game states). Choosing `NEW EXPEDITION` does not start a game directly:
it opens the mode select menu (`specs/modes.md`), where the player picks Standard or
Hardcore; that leads to the world size select (`specs/world.md`, `specs/ui.md`), Quick,
Standard, or Marathon, and choosing a size begins the expedition in the picked mode at
the picked size.

There is one expedition, played the same way every time (the mine is generated per game
within the fixed rules of `specs/world.md`, at the chosen world size, which scales only
how deep the dig is, not the systems, values, or goal). The miner starts on the surface
with tier-1 gear on every upgrade track (`specs/upgrades.md`), `0` Credits, an empty
cargo, and an empty rocket (`specs/rocket.md`), and:

- digs down through the four bands, selling ore for Credits and buying upgrades
  (`specs/mining.md`, `specs/upgrades.md`);
- mines the two buried exotic materials (Resonite in the rockbed, Cryenite in the
  deepstone) with the scanner's help (`specs/mining.md`);
- makes the core run to extract the unstable Core Sample and haul it up inside its
  90-second timer (`specs/hazards.md`);
- fabricates all five rocket components and launches to win (`specs/rocket.md`).

The chosen mode (`specs/modes.md`) governs only what happens on death. Everything else
(the world, the economy, the hazards, the goal) is identical across modes and across
runs. PLAY AGAIN on an end screen replays a fresh expedition in the same mode and world
size.

## Credits and the economy

Credits are the currency. There is exactly one source and four sinks:

- Source, selling ore. Selling your cargo at the Ore Market (`specs/mining.md`) pays
  each ore's listed value and empties the bay. This is the only way to earn Credits.
- Sink, fuel and repair. Buying jetpack fuel and hull repair at the Fuel Depot
  (`specs/character.md`, `specs/world.md`), per unit and per point. Fuel and hull never
  refill for free or on their own; restoring them is a running cost of every trip.
- Sink, upgrades. Buying tiers on the seven upgrade tracks (fuel tank, drill, cargo
  bay, hull, jetpack, radiator, scanner) at the Upgrade Shop (`specs/upgrades.md`).
- Sink, field supplies. Buying the six single-use field supply items (explosives,
  teleporters, nanobots, emergency fuel) at the Supply Depot, its own surface building,
  separate from the Upgrade Shop (`specs/items.md`, `specs/world.md`). Each is bought
  with Credits and carried as a count.
- Sink, the rocket. Fabricating the five rocket components at the Launch Pad
  (`specs/rocket.md`).

You start with `0` Credits and an empty cargo. Credits never go negative; an action you
cannot afford is disabled. Credits are banked: once earned they are safe, and they
survive death in both modes (`specs/modes.md`).

## The surface loop

The surface camp (`specs/world.md`) is the hub every dig returns to. Arriving at the
surface:

- Does not refuel or repair on its own. Fuel and Hull are exactly what the miner
  climbed out of the mine with (`specs/character.md`, `specs/world.md`). The surface is
  where you can pay to restore them, not where they restore for free.
- lets you sell (Ore Market), buy fuel and hull repair (Fuel Depot), upgrade (Upgrade
  Shop), buy field supplies (Supply Depot), and fabricate rocket parts (Launch Pad) via
  each building's overlay panel, and save (Save Pad) on the spot (`specs/controls.md`).

The rhythm of the game is: descend and fill cargo (and hunt a material, or make the
core run), climb back before fuel or hull runs out, sell, pay to refuel and repair,
spend what is left on the upgrade or rocket part this trip earned, and go again, a
little deeper each time.

## Saving and continuing

The expedition can be saved so a session can be resumed later. Saving is explicit and
restricted:

- Only at the Save Pad. The surface Save Pad building (`specs/world.md`) is the only way
  to save; there is no autosave and no saving underground. The pad has no menu:
  activating it (the activate key or a click) writes the save directly, with a note
  confirming it (or explaining why it is blocked, for example the Core Sample is live).
- One save at a time. There is a single save slot; saving overwrites it. Starting a NEW
  EXPEDITION abandons any existing save.
- CONTINUE. When a save exists, the main menu shows a CONTINUE entry that resumes it
  exactly where it was saved (`specs/ui.md`, Game states).
- What a save holds. Enough to resume the surface state: the generated mine (at its
  world size, `specs/world.md`, so a restored expedition keeps its dimensions), banked
  Credits, all upgrade tiers, installed rocket components, held field-supply item counts
  (`specs/items.md`), the cargo and materials, and the miner's fuel and hull. Saving is
  refused while the unstable Core Sample's timer is running, whether it is carried or
  jettisoned as a ground item (`specs/hazards.md`, `specs/items.md`), so its timer is
  never frozen out by saving and quitting.
- When the save ends. A Hardcore death deletes the save (permadeath); a victory consumes
  it. A Standard death keeps it, so the run can be restored from the Game Over screen
  (`specs/modes.md`).

The implementation may persist the save however it likes within the browser (for
example `localStorage`); the game must still run if that storage is unavailable, simply
without saving. This is the one persisted-progress feature; everything else is
per-session.

## Scoring / summary

There is no running numeric score. The end screens (Victory, Game Over) show a run
summary: deepest depth reached (m), total Credits earned, elapsed time, mode, and
rocket components installed. The summary is for the result screen only and is not
persisted; the only persisted state is the save (above).
