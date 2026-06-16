# Coil — Feast mode

This file defines the **Feast** mode. It builds on the board in
`specs/playfield.md`, the simulation in `specs/mechanics.md`, and the scoring and
flow in `specs/flow.md`. Everything in Classic mode applies except where this
spec overrides it.

## Menu entry

This mode spec adds the following entry to the main menu (see Game states in
`specs/flow.md`), directly **after** `CLASSIC`:

- `FEAST`

## Mode

- **Feast** — the same fully enclosed `30 x 18` board as Classic, plus a
  periodic, time-limited **bonus orb** that appears in addition to the ordinary
  pellet. The orb is worth far more than a pellet but only stays for a few
  seconds, so it rewards a player willing to take a risky detour for points.

### The bonus orb

- The standard pellet behaves exactly as in Classic and is always present. The
  bonus orb is **separate** and is present only some of the time. There is at
  most **one** bonus orb on the board at any moment.
- The orb occupies a single cell drawn in the bonus-orb color with a soft glow,
  visibly distinct from the pellet. It **blinks** the whole time it is present,
  and blinks **faster** during its final **2 seconds** to warn it is about to
  leave.
- **Spawning.** The first orb appears **8 seconds** of simulation time into a
  round. Each orb stays for **6 seconds**; if it is not eaten in that time it
  **despawns**. After an orb leaves — whether eaten or expired — the next orb
  appears **8 seconds** later. All these timers are measured in simulation time
  and advanced with the tick (step 6 in `specs/mechanics.md`).
- **Placement.** An orb spawns at a uniformly random valid cell, using the same
  validity rule as a pellet (an empty interior cell, not on the snake, the
  pellet, a wall, or an obstacle; see Placement in `specs/playfield.md`). The orb
  never shares a cell with the pellet.
- **Eating.** When the snake's head enters the orb's cell, the orb is eaten. It
  awards `50 * M` points (where `M` is the current combo multiplier from
  `specs/mechanics.md`) and counts as a combo eat: it raises `M` by one (capped
  at 5) if the combo window is open, or resets `M` to 1 if it had lapsed, and
  then reopens the 2.4 s combo window — exactly as eating a pellet does. Eating
  the orb does **not** grow the snake and does **not** spawn a pellet (the
  pellet on the board is untouched).

Walls, tick rate, single-pellet placement, growth, and the body/tail collision
rule are all unchanged from Classic; Feast only adds the bonus orb described
here.
