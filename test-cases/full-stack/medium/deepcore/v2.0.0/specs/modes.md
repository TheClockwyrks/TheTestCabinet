# Deepcore — Standard and Hardcore

This file defines the two modes an expedition is played in. The mode changes only
what happens when the miner dies. World generation, ore values, fuel and hull
figures, upgrade prices, rocket costs, hazards, and the scanner are identical in
both.

## What a death is

A death is any of:

| Cause | Id |
| --- | --- |
| Fuel reaching `0` below the surface ground line | `fuel-out` |
| Hull standing at `0` | `hull-destroyed` |
| The Core Sample's timer expiring while it is carried, or while it lies jettisoned within its blast radius | `core-detonation` |

In both modes a death ends the expedition at the Game Over screen, destroys a Core Sample
held or ticking on the ground, and leaves every installed rocket component
installed. There is no respawn and no dropped cache.

A death takes effect the moment its cause holds and cannot be undone. Play does
not resume from it, and the mode's consequence below is applied then rather than
when the Game Over screen arrives, so nothing done after the death changes what it
costs.

## Standard

A death costs the progress made since the last save.

- With a save present, the Game Over screen offers `CONTINUE FROM SAVE` and
  `MENU`. Restoring puts the player back on the surface with the saved mine,
  Credits, upgrade tiers, installed components, cargo, materials, fuel, and hull.
  The save survives the death and can be restored again.
- With no save present, the Game Over screen offers `PLAY AGAIN` and `MENU`.

## Hardcore

A death ends the expedition.

- The save is deleted, so a save banked at the pad does not survive the death.
- The Game Over screen offers `PLAY AGAIN`, which starts a completely fresh
  Hardcore expedition at the same world size, and `MENU`.
- A Hardcore save still resumes an expedition in progress through `CONTINUE`; it
  cannot rescue a death.

The mode-select screen states each rule before the choice is made: Standard, a
death lets the expedition be restored from the last save; Hardcore, a death
deletes the save and ends the expedition.
