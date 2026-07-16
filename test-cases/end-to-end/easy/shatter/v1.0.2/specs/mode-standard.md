# Shatter — Standard mode

This file defines the **standard** ruleset for this build. It builds on the common
specification: the overview and palette in `specs/overview.md`, the field, star,
ship, rocks, bullets, and saucer in `specs/playfield.md`, the simulation, gravity
well, and collision rules in `specs/physics.md`, and the scoring, lives, waves,
saucer behavior, states, controls, and HUD in `specs/flow.md`.

The standard game is Shatter exactly as the common specs describe it — inertial
flight, the central gravity well, escalating waves, the hunting saucer, lives and
respawns, and the full state machine — with **no rock armor and no secondary
weapon**. This file states the two things the common specs defer to `specs/mode.md`:
how rocks take damage, and which weapons the ship carries. Everything else is as the
common specs describe.

The title screen and menu are as described in `specs/flow.md` (`PLAY` / `HOW TO
PLAY`); choosing `PLAY` starts the standard game.

## Rocks take a single hit

Rocks have **no health or armor**: a single bullet hit destroys a rock outright.
On that hit the bullet is removed (per the Bullet ↔ rock rule in `specs/physics.md`)
and the rock **splits** and **scores** exactly as the common specs describe
(Large → two Medium, Medium → two Small, Small → nothing; per-size score from
`specs/flow.md`). There is no multi-hit rock and no damage state — a rock looks the
same right up to the single hit that destroys it, at which point it shatters and
its fragments fan apart perpendicular to the shot (`specs/physics.md`).

Rocks created by a **split**, and rocks that re-enter after being **recycled by the
star** (`specs/playfield.md`), are ordinary single-hit rocks like any other.

## Primary gun only

The ship carries **only its primary gun** — the round bullets fired with `Space`
(`specs/flow.md`, `specs/physics.md`). There is **no** secondary weapon and no
alternate fire: the only thing that destroys a rock is a bullet, and clearing the
field means shooting every rock down through its splits until the last fragments
wink out. No self-propelled munition is added, so the only bodies the star does not
pull remain the ship and the saucer (`specs/physics.md`).

The controls, HUD, and How-to-play screen are exactly as `specs/flow.md` describes
them; the standard mode adds nothing to any of them.
