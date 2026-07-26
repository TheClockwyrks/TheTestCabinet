# Holdfast — The day/night cycle

This file defines the passage of time: the day/night cycle, how it presses on the
colony's work and rest, and how it biases the raids. It builds on the settlers in
`specs/settlers.md` (whose rest and schedule it drives), the economy in
`specs/economy.md` (crops that grow by day), and the threat director in
`specs/combat.md` (which favors certain hours). The **day count** it produces is the
colony's age and the game's primary score (`specs/flow.md`).

## Cycles

Time is measured in **days** (cycles), each a fixed span of simulation time run on the
fixed tick (`specs/controls.md`). A day advances through **daylight** and **night** —
you may model any number of phases (dawn / day / dusk / night, or simply day and
night), but the two that must be legible and felt are **day** and **night**. The
current day and the time-of-day are shown on the HUD clock (`specs/flow.md`).

## What the cycle changes

The day/night cycle is a **real pressure on scheduling**, not merely a background tint:

- **Rest and sleep.** Settlers' rest drains faster at night and they **sleep by
  preference at night** (`specs/settlers.md`), so the colony naturally works by day and
  rests by dark — and a colony forced to work or fight through the night pays for it in
  rest and mood. A settler with a **bed** rests better than one on the ground
  (`specs/economy.md`).
- **Light and legibility.** Night **darkens** the map — draw it as a cooling, dimming
  overlay (`specs/overview.md`) so the hour reads at a glance — and the colony's own
  light (and muzzle flashes in a fight) carry the scene. **Night must never black the
  map out** so far that the colony cannot be read or played; keep it legible. Daylight
  may aid work or farm growth (your choice; state it in the `README`).
- **Farming.** If your crops grow only (or faster) in daylight (`specs/economy.md`),
  the day/night cycle sets the farm's rhythm — state any such rule in the `README`.

## Time and raids

The threat director (`specs/combat.md`) **favors certain times of day**: many raids
strike at **night**, when the colony is tired, its settlers want to sleep, and the dark
hides the attackers' approach — so a night raid is a distinct and nastier event than a
day one. Not every raid need come at night, but the cycle must visibly bias when danger
arrives, so that the time of day is something the player watches and plans around (pull
the crew in and post the guard before dark). Announce an incoming raid regardless of the
hour (`specs/combat.md`).

## Speed and pause

The day/night clock runs at the current **simulation speed** and freezes when **paused**
(`specs/controls.md`), so the player can fast-forward a quiet day and slow a night raid
to a manageable pace. The clock never advances while the game is paused.
