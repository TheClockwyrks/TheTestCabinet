# Coil — Game loop, movement, collision, and the combo mechanic

This file defines how the game advances and how the snake moves and interacts
with the board. It builds on the geometry in `specs/playfield.md` and the
coordinate system in `specs/overview.md`.

## The game loop

The simulation runs on a **fixed timestep**: the game advances in discrete
**ticks**, and the snake moves exactly **one cell per tick** in its current
direction. The tick rate is constant for the whole round — there is **no
speed-up** as the snake grows or the score rises.

- The base tick interval is **125 ms** (**8 ticks per second**). A mode spec
  under `specs/modes/` may state a different interval; when none does, 125 ms
  applies.
- Decouple **rendering** from the tick (for example, draw with
  `requestAnimationFrame`) so the display stays smooth while the simulation
  steps at the fixed rate. Rendering must never advance the simulation; only a
  tick does.
- The tick rate must not depend on the rendering frame rate or the machine's
  speed. Two machines running the same inputs must produce the same sequence of
  board states.

### Order of operations within a tick

Each tick, in this exact order:

1. **Apply input.** Take the next buffered turn, if any, and update the snake's
   direction (see Turning).
2. **Advance the head.** Compute the new head cell as the current head cell plus
   the current direction.
3. **Resolve collision.** Test the new head cell for a fatal collision (see
   Collision). If it is fatal, the round ends immediately and steps 4–6 do not
   run.
4. **Eat or move.** If the new head cell holds a pellet, the snake **grows**:
   prepend the new head and do **not** remove the tail. Otherwise the snake
   **moves**: prepend the new head and remove the current tail cell.
5. **Resolve food.** If a pellet was eaten, apply scoring and the combo (see
   below), then spawn a new pellet (see `specs/playfield.md`).
6. **Advance timers.** Decrement the combo window and any mode timers by the
   tick's elapsed time; expire them if they reach zero (see Combo).

This order is what makes the subtle cases correct; follow it exactly.

## Movement

The snake advances one cell per tick in its current direction (one of up, down,
left, right). It moves continuously from the moment the round starts until the
round ends; it can never stop or stand still.

## Turning

The player steers with the arrow keys or `WASD` (see Controls in
`specs/flow.md`). Turning obeys these rules:

- A turn takes effect on a **tick boundary**, not instantly: a requested
  direction is applied at step 1 of the next tick.
- The snake may only turn **perpendicular** to its current direction. While
  moving horizontally, only up/down are valid; while moving vertically, only
  left/right are valid. A request to continue straight is a no-op, and a request
  to **reverse** directly into the neck is **ignored** (the snake can never
  reverse onto itself in a single tick).
- **One turn per tick.** Buffer requested turns in a short queue (hold at most
  **two**). At step 1 of each tick, take the oldest queued request and apply it
  only if it is a valid perpendicular turn **relative to the direction the snake
  is actually moving this tick**; discard it otherwise. This is what prevents a
  fast double-press (e.g. while moving right, pressing *down* then *left* within
  one tick) from folding the snake back on itself: the *down* is applied this
  tick, and *left* — now a valid perpendicular turn — is applied on the
  following tick, never both at once.

**Presentation.** A body cell whose head-ward and tail-ward neighbors are
**perpendicular** is a bend: render it with the produced **corner sprite**, and
render straight runs with the straight-body sprite, so a turning snake reads as a
continuous coil rather than a staircase of squares. The exact sprite set and how it
is oriented per cell is defined in `specs/assets.md`; this is rendering only and does
not affect the simulation.

## Collision

Collision is tested against the **new head cell** computed in step 2, before the
tail is resolved. The head moving into any of the following ends the round
immediately:

- **A wall cell** — any perimeter cell (see `specs/playfield.md`). (A mode that
  replaces the walls with wrapping edges removes this case for those edges, as
  that mode spec defines.)
- **The snake's own body** — any cell occupied by a body segment, subject to the
  tail rule below.
- **An obstacle cell** — only in modes that place interior obstacles, as that
  mode spec defines.

There are **no** grace frames, forgiveness windows, or second chances: a single
fatal collision ends the round.

### The tail rule (self-collision)

Because the tail vacates its cell as the head advances, the cell the tail is
*leaving* must be treated as free for the head on a normal move — but not on a
growth tick, when the tail does not move. Concretely:

- On a **normal** tick (no pellet eaten), the tail will vacate its current cell
  this tick, so the new head cell is **not** a collision if it equals the
  current tail cell. The snake may safely follow its own tail.
- On a **growth** tick (a pellet is in the new head cell), the tail does **not**
  retract, so the full body — including the current tail cell — is solid, and
  moving the head into any of it (including that tail cell) is fatal.

Evaluating collision against the post-move body (head advanced, tail retracted
only on a normal tick) produces both behaviors correctly.

## Growth

Eating a pellet grows the snake by exactly **one** cell, by not removing the tail
on that tick (step 4). On every non-eating tick the length is constant: one cell
added at the head, one removed at the tail. The body therefore always traces the
exact path the head has taken, with no gaps or branches.

**Presentation.** On the eat tick, play the produced **head-bite** animation — the
head's mouth opens and chomps shut — then return the head to its resting frame (see
`specs/assets.md`). It is a visual flourish tied to the eat and does not affect the
simulation or its timing.

## The combo mechanic (signature)

Score is shaped by a **combo multiplier** that rewards eating pellets in quick
succession. This is Coil's defining mechanic.

- The multiplier `M` is an integer, starts each round at **1**, and is capped at
  **5**.
- A **combo window** of **2.4 seconds** of simulation time governs the
  multiplier. Eating a pellet (re)opens a fresh 2.4 s window.
- When a pellet is eaten:
  - if the combo window was **open** (i.e. it had not yet expired since the last
    pellet), `M` increases by one, to a maximum of `5`;
  - if the window was **closed** (this is the first pellet of the round, or the
    window had lapsed), `M` resets to `1`.
  - The pellet then awards `10 * M` points using the updated `M`, and the window
    reopens for another 2.4 s.
- If the combo window **lapses** without a pellet being eaten (step 6 expires
  it), `M` resets to `1`.

The window is measured in simulation time and decremented each tick by the
tick's elapsed time, so it is independent of the tick rate. At the base 8-ticks-
per-second rate, 2.4 s is roughly 19 ticks — enough travel to reach most
pellets if you take an efficient route, but easily lost by wandering.

The full scoring rules, including how the multiplier and its window are shown in
the HUD, are in `specs/flow.md`. Modes that introduce a bonus orb state how the
orb interacts with the combo in their own mode spec under `specs/modes/`.
