# Shatter — Standard mode

This file states the two things the common specification defers to `specs/mode.md`:
how rocks take damage, and which weapons the ship carries. Everything else is as the
common specs describe it, the game in `specs/overview.md`, `specs/field.md`,
`specs/ship.md`, `specs/hazards.md`, `specs/simulation.md`, and `specs/rules.md`.

The standard game is Shatter as the common specs describe: inertial flight, the
central gravity well, escalating waves, the hunting saucer, lives and respawns, and
the full state machine, with no rock armor and no secondary weapon.

The title screen and menu are as described in `specs/rules.md` (`PLAY` / `HOW TO
PLAY`); choosing `PLAY` starts the standard game.

## Rocks take a single hit

Rocks have no health or armor: a single bullet hit destroys a rock outright. On that
hit the bullet is removed (per the bullet-and-rock rule in `specs/simulation.md`) and
the rock splits and scores exactly as the common specs describe (Large to two Medium,
Medium to two Small, Small to nothing; per-size score from `specs/rules.md`). A rock
looks the same right up to the single hit that destroys it, at which point it shatters
and its fragments fan apart perpendicular to the shot (`specs/simulation.md`).

Rocks created by a split, and rocks that re-enter after being recycled by the star
(`specs/hazards.md`), are ordinary single-hit rocks like any other.

## Primary gun only

The ship carries only its primary gun, the round bullets fired with `Space`
(`specs/ship.md`, `specs/rules.md`). There is no secondary weapon and no alternate
fire: the only thing that destroys a rock is a bullet, and clearing the field means
shooting every rock down through its splits until the last fragments wink out. No
self-propelled munition is added, so the only bodies the star does not pull remain the
ship and the saucer (`specs/simulation.md`).

The controls, HUD, and how-to-play screen are exactly as `specs/rules.md` describes
them; the standard mode adds nothing to any of them.
