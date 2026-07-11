# Coil — Classic and Feast modes

This file defines this build's two playable modes, **Classic** and **Feast**, and
their main-menu entries. It builds on the board in `specs/playfield.md`, the
simulation in `specs/mechanics.md`, and the scoring and flow in `specs/flow.md`.

## Menu entries

This spec adds the following entries to the main menu (see Game states in
`specs/flow.md`), in this order, before `HOW TO PLAY`:

- `CLASSIC` — the **first** menu item.
- `FEAST` — directly **after** `CLASSIC`.

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a mode, and is always
shown last in the menu.)

## Classic

- **Classic** — the standard game on the fully enclosed `30 x 18` board from
  `specs/playfield.md`. The four perimeter walls are **solid and fatal** and the
  board does **not** wrap, so the interior playable area is `28 x 16` (`col` in
  `[1, 28]`, `row` in `[1, 16]`). Exactly one pellet is on the board at a time,
  there are no interior obstacles, and there is no bonus orb. It uses the 125 ms
  tick interval, the standard single-pellet placement, the combo scoring, and the
  standard collision and growth rules.

## Feast

Everything in Classic applies to Feast except where this section overrides it.

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
