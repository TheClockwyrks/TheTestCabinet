# Spectra — Simulation, movement, controls, firing, and the discharge

This file defines the simulation core, how the ship moves, the controls, how
firing works, and the discharge control. It builds on the play field and ship in
`specs/playfield.md` and the polarity systems in `specs/polarity.md`.

## Simulation

Run the simulation on a fixed timestep (for example 120 Hz) decoupled from
rendering, so movement, firing, and the drones' paths are reproducible; do not tie
the simulation to the render frame rate. The core advances by integrating whole
fixed steps and does not depend on a canvas or on wall-clock time to make
progress: rendering reads the state, never the other way around. Any randomness
the game uses, such as which drone dives next or a Flux's starting phase, runs off
a seedable generator, so the same seed and the same sequence of inputs reproduce
the same game exactly. This deterministic, steppable core is also what the
debugging and automation surface in `specs/instrumentation.md` rests on.

## Movement

- The ship moves left and right only, along its fixed lane at `y = 600`
  (`specs/playfield.md`).
- It moves at a constant `360 px/s` while a horizontal direction is held and stops
  promptly when released: crisp, responsive control with no drift or inertia.
- Its center `x` is clamped to `[40, 1240]` so the whole ship stays on screen;
  there is no screen wrap for the ship (only drones wrap, per `specs/playfield.md`).

## Controls

Keyboard only.

- Move: `Left` / `Right` arrow keys or `A` / `D`.
- Fire: `Space` (or `Up` / `W`) fires a bullet of your current band (below).
- Flip band: `Shift` (either) or `F` flips your current band between cyan and
  magenta (see `specs/polarity.md`). The flip is instant and imposes the `0.30 s`
  fire lockout.
- Discharge: `X` releases a discharge when the resonance meter is full (see
  `specs/polarity.md`); it does nothing when the meter is below full.
- Pause: `Esc` or `P`.
- Menus / pause / game-over: `Up` / `Down` (or `W` / `S`) move the selection,
  `Enter` or `Space` confirms, `Esc` goes back.

A held fire key auto-repeats at the fire cadence below; a held flip or discharge
key does not auto-repeat (each acts once per press).

## Firing

- A shot spawns at the ship's nose and travels straight up at `760 px/s`. A bullet
  is about `4 px` wide and `16 px` tall.
- Cadence. Firing is limited to one shot every `0.16 s`.
- On-screen cap. At most `3` of your bullets exist on the field at once; firing is
  blocked until one clears or expires.
- Band. Each shot carries your current band at the instant it is fired
  (`specs/polarity.md`), fixed for the bullet's life. Bullets already in flight do
  not change band when you flip.
- Lockout. You cannot fire during the `0.30 s` lockout after a flip
  (`specs/polarity.md`).

## The discharge control

Pressing `X` when the resonance meter reads full (`100`) spends the whole meter
and fires the screen-clearing discharge burst defined in `specs/polarity.md`. It
is band-blind, it does not depend on your current band, and is the only control
that does. While a discharge animation is playing, normal firing and movement
continue as usual.
