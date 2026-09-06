# Spectra — The frame

This file defines how a frame advances the game, how a frame is divided, the order
a division resolves in, how a contact is decided, and where each random draw the
game makes is stated.

## Rates and the delta time

Every rate in this specification is per second and every duration is in seconds.
There is no fixed timestep. Each update is handed the elapsed time of its frame, in
seconds, and integrates against it, so the same interval of game time reaches the
same state however it was divided into frames.

## Sub-steps

An update covering `dt` seconds is divided into `n = max(1, ceil(dt / SUBSTEP_MAX))`
sub-steps of `h = dt / n` seconds each, with `SUBSTEP_MAX` (`1/120` of a second)
the furthest a single sub-step may carry anything. The sub-steps run in order, and
each one advances every moving thing by `p += v * h` and then resolves contacts.

One second of game time therefore covers the same ground whether it arrives as one
frame, as sixty, or as a hundred and twenty: each runs a hundred and twenty
sub-steps of `1/120` of a second.

`simTime` is the accumulated simulation time in seconds. Each sub-step adds its own
`h` to it, so a second of game time adds exactly the same total to it however that
second was divided into frames.

## The order a sub-step resolves in

After every position has advanced by `h`, one sub-step resolves in this order:

1. Each of the player's bullets against every drone, nearest drone first. A contact
   consumes the bullet and applies `specs/bands.md`'s rule to the drone.
2. Each enemy bullet against the ship. A contact consumes the bullet and applies
   the shield rule in `specs/bands.md`.
3. Each drone's body against the ship.
4. The live discharge wave against the drones and the enemy bullets it has reached.
5. Everything marked for removal leaves its roster, and every destroyed drone
   starts its drone-burst.

## The contact model

Every contactable thing is a circle about its center, of the half-extent its own
spec states, and a contact is an overlap of two such circles tested at the end of
each sub-step. `specs/ship.md` states the ship's and a player bullet's half-extents,
`specs/swarm.md` an enemy bullet's, and `specs/drones.md` each drone kind's.

The discharge wave is the one exception: it is a circle centered on the ship whose
radius grows over the wave's life, and it reaches a thing when that thing's center
lies inside the wave's current radius. `specs/resonance.md` states the wave.

## Randomness

The game draws at random where the spec that owns the rule states the draw: which
formation drone a dive launch takes and the gap before the next launch in
`specs/swarm.md`, the band clock a Flux starts its first window at in
`specs/drones.md`, the scatter of each drone-burst in `specs/assets.md`, and any
draw `specs/mode.md` states for the mode this build ships. Each draw is stated as
the set it is drawn from and the chance each outcome carries. A choice a spec leaves
to the build, such as which slots a wave fills, is the build's to draw or to fix.
