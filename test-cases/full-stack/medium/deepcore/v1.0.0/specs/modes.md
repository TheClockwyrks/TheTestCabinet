# Modes: Standard and Hardcore

This file defines the two modes a player chooses before an expedition, and the
mode-select menu that leads into them. It builds on the miner's death conditions
(`specs/character.md`: out of fuel, hull destroyed, and the Core Sample detonation of
`specs/hazards.md`), the cargo and materials (`specs/mining.md`), and the states and
menus (`specs/ui.md`).

There is exactly one campaign and one balance. The mode changes only what happens when
the miner dies, nothing else. The world generation, the ore values, the fuel and hull
numbers, the upgrade prices, the rocket costs, the hazards, and the scanner all work
identically in both modes. The numeric values elsewhere are fixed; the mode is purely
the death rule.

## The menu flow

The title menu's play action is a single NEW EXPEDITION entry (followed by HOW TO PLAY;
see Game states in `specs/ui.md`). Choosing it does not start a game directly; it
opens the mode select menu. From there:

- Choosing Standard or Hardcore advances to the world size select (`specs/world.md`,
  `specs/ui.md`); picking a size there starts a fresh expedition in the chosen mode at
  the chosen size. The size is independent of the mode; it scales only how deep the mine
  goes, not the death rule.
- A BACK choice returns to the title menu.

The mode-select menu must show each mode with a clear, readable description of its death
rule (below) so the player understands the stakes before choosing, and must offer a way
back to the title menu.

## What a "death" is

A death is any of: running out of fuel underground, hull reaching 0, or the Core Sample
detonating when its timer expires (`specs/character.md`, `specs/hazards.md`). All three
are handled by the mode's death rule below. In both modes, a death destroys the Core
Sample if the miner was carrying it (`specs/mining.md`, `specs/hazards.md`), the Core
Sample never survives a death, and leaves every already-installed rocket component
installed (`specs/rocket.md`): the rocket checklist is durable progress that no death
undoes.

## Standard

The forgiving mode: a death costs you your progress since the last save, not the whole
run. It relies on the save system (`specs/gameplay.md`): the player banks progress at the
surface Save Pad, and a death lets them restore it.

- On death, the run ends at the Game Over screen (`specs/ui.md`) showing the run
  summary. There is no respawn and no dropped cache; a death simply ends the current
  run.
- If a save exists, the Game Over screen offers CONTINUE FROM SAVE, which restores the
  last save (the world, banked Credits, upgrade tiers, installed rocket components,
  cargo, materials, and the miner's fuel/hull as they were when saved) and drops the
  player back at the surface to carry on. The save survives the death, so it can be
  restored again if the next attempt also fails.
- If there is no save (the player never used the Save Pad this run), there is nothing to
  restore: the Game Over screen offers PLAY AGAIN (a fresh Standard expedition) and
  MENU. This is why the Save Pad matters: saving early makes a death recoverable.
- The cost of dying is therefore the progress made since the last save, plus, on a
  failed core run, going back down for a fresh Core Sample.

## Hardcore

The unforgiving mode: death ends the expedition for good.

- On death, the run is over immediately; the game goes to the Game Over state
  (`specs/ui.md`), showing the run summary (deepest depth, Credits, components
  installed, and how the miner died).
- There is no respawn and no dropped cache, and the save is deleted; Hardcore is
  permadeath, so even a save banked at the pad does not survive the death. PLAY AGAIN
  starts a completely fresh Hardcore expedition (new world at the same world size, `0`
  Credits, tier-1 gear, an empty rocket); MENU returns to the title. (A Hardcore save is
  still useful for quitting and resuming a run in progress via CONTINUE; it just cannot
  rescue a death.)
- Because a single mistake ends everything, Hardcore rewards caution: banking Credits
  often, upgrading hull and fuel before pushing deep, and treating the 90-second core
  run as the genuine gamble it is.

The mode-select menu makes this contrast explicit: Standard, "a death lets you restore
from your last save and keep going"; Hardcore, "a death deletes your save and ends the
expedition." Both play the same mine to the same rocket; only the price of dying
differs.
