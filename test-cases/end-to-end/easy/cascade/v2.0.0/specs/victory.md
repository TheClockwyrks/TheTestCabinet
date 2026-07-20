# Victory cascade

## Overview

This file defines the victory cascade, the animation that plays when the game is
won and the feature the game is named for. It builds on the layout in
`specs/table.md`, the win condition in `specs/rules.md`, and the coordinate system
in `specs/overview.md`. Implement it exactly; it is the game's signature mechanic.

## Trigger condition

The cascade begins the instant the game is won, with all 52 cards on the
foundations (`specs/rules.md`). Normal play stops; the tableau, stock, and waste
are now empty, and only the four completed foundations remain on the table. The
cascade then launches those foundation cards, one at a time, to bounce down and
across the table, each leaving a permanent painted trail, until the whole table is
covered and every card has flown off the edges.

## Simulation

Run the animation on a fixed timestep (for example 120 Hz) decoupled from
rendering, integrating each in-flight card's motion every step, so the motion is
reproducible and independent of the render frame rate. All values below are in the
logical-pixel space of `specs/overview.md` (`x` right, `y` down); acceleration is
in `px/s²`, velocity in `px/s`.

### Launching cards

- Cards launch one at a time at a steady cadence of one every `0.18 s` (about 5–6
  per second).
- Launch order cycles the four foundations: take the current top card of a
  foundation, launch it, then move to the next foundation, and repeat. Because the
  foundations are complete, this walks each foundation down from King to Ace over
  its turns. Continue until all 52 cards have been launched.
- A launched card starts at the on-table position of the foundation it came from
  (`specs/table.md`) and becomes an independent falling card with an initial
  velocity:
  - horizontal: `vx` of random magnitude in `[180, 420]` with a random sign (left
    or right), so every card eventually clears a side edge;
  - vertical: `vy = −120` (a slight upward pop) so the card arcs before falling.

### Motion and bouncing

Each in-flight card, every step:

1. Apply gravity: `vy += 1800 * dt`.
2. Advance: `x += vx * dt`, `y += vy * dt`.
3. Bounce off the bottom. When the card's bottom edge reaches the table floor
   (`y + 140 >= 720`) while moving down, reflect and damp the vertical velocity,
   `vy = −vy * 0.80`, and seat the card back on the floor (`y = 720 − 140`). The
   horizontal velocity is unchanged (no floor friction), so the card keeps
   drifting sideways and its bounces lose height each time.

The card does not collide with anything else, not the walls, not the other cards,
not the foundations. It simply falls, bounces on the floor, and drifts off one
side.

### Painted card trail

This is what makes the cascade read the way it should: the in-flight cards are
drawn onto a persistent layer that is not cleared between frames. Every step (or
every rendered frame), each moving card is drawn at its current position on top of
whatever is already painted, so a card leaves a dense trail of overlapping card
images tracing its arc; the table fills with bouncing-card streaks rather than
showing a single moving sprite. The trail is opaque card images, not a fade; the
screen progressively fills as more cards launch and bounce.

- The four completed foundations (the cards not yet launched) remain drawn in
  place beneath the accumulating trail until each is launched in turn.
- Do not clear the painted trail while the cascade runs.

### Ending

- A card is retired once its entire footprint has passed beyond the left edge
  (`x + 100 < 0`) or the right edge (`x > 1280`). Because every card carries a
  minimum horizontal speed, all 52 retire in finite time.
- When the last card has launched and retired, the cascade is complete. Show a
  brief `YOU WIN` message over the painted table with a prompt to start a new game
  (see `specs/states.md`). The painted trail stays behind the message until the
  player starts a new game, which clears it and deals anew.
- The player may dismiss early: a click or the New Game control at any point during
  the cascade clears the painted layer and deals a new game.

The result is the classic patience finale, a screen slowly buried under arcs of
bouncing cards, produced here from an original deck on an original table.
