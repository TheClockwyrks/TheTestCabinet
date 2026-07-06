# Spectra — The stage: player lane, formation, lanes, bullets, and HUD

This file defines the geometry of the stage and the things in it. All positions
and sizes are in the logical-pixel coordinate system defined in
`specs/overview.md` (a fixed `1280 x 720` stage; the play field is `y` in
`[64, 656]`, full width).

## The play field

Everything that moves — the player ship, the drones, and every bullet — lives in
the **play field**, the region `y` in `[64, 656]` spanning the full width
`x` in `[0, 1280]`. The starfield is drawn behind it. The HUD strips above (`y` in `[0, 64]`) and
below (`y` in `[656, 720]`) are reserved for the HUD and are never overlapped by
play, other than a drone crossing a strip purely in transit — a diving drone
wrapping down through the bottom to reappear from the top, or a drone flying in
from above at the start of a wave. The player ship, the formation, and bullets
all stay within `[64, 656]` (see Dives in `specs/enemies.md`).

## The player ship

- The ship is a small fighter about **40 px** wide and **28 px** tall, drawn in
  the hull color with a glowing core in its **current band's** color (see
  `specs/polarity.md`). It is rendered from the provided fighter sprite, re-tinted
  to the ship's current band (see `specs/assets.md`).
- It travels along a **fixed horizontal lane** near the bottom: its center stays
  at **`y = 600`** at all times. It only moves left and right.
- Its center `x` is clamped to **`[40, 1240]`** so the whole ship stays on screen.
- Movement, firing, and the band flip are defined in `specs/controls.md`.

## The formation

Drones that have finished entering hover in a **formation**: a block of fixed
**slots** near the top of the play field that drifts side to side as one rigid
body.

- **Slot grid.** Slots sit on a grid of **64 px** horizontal by **48 px**
  vertical spacing. The formation occupies up to **9 columns** across and **5
  rows** down. Center the grid horizontally on the stage centerline `x = 640`, so
  with 9 columns the slot centers are at `x = 640 + 64 * (c - 4)` for column
  `c` in `0..8`. Row `r` in `0..4` has its slot centers at `y = 140 + 48 * r`, so
  the formation spans roughly `y` in `[120, 320]`.
- **You design which slots are filled and by which drone**, subject to: the
  layout is **mirror-symmetric** left-to-right about `x = 640` (neither side is
  favored); it mixes **both bands** (see below); and it reads as a deliberate
  formation, not a random scatter. Not every slot need be filled, and the filled
  shape may change per stage.
- **Both bands are always present.** A formation must always contain drones of
  **both** the cyan and magenta bands at once — this is what forces the player to
  keep flipping (see `specs/polarity.md`). A formation that is entirely one band
  is not allowed.
- **Sway.** The whole formation translates horizontally as one unit in a slow
  sinusoid: center offset `dx = 20 * sin(2 * PI * t / 5)` px (amplitude **20 px**,
  period **5 s**), so the block slides gently `±20 px`. Every slotted drone moves
  with it, holding its relative position. The sway does not change which slots are
  filled.

A drone in formation sits in its slot (plus the sway) until it is chosen to dive
or is destroyed (see `specs/enemies.md`).

## Entry and exit lanes

Drones are not present at the start of a wave — they **fly in**:

- At the start of a wave, drones enter from **off-screen above the play field**
  (from `y < 64`, through the top edge) in staggered groups, each following a
  smooth curved path you design down to its assigned slot (see Entrances in
  `specs/enemies.md`). Entry paths may cross the upper field and loop; they must
  be continuous (no teleporting) and end with the drone settling into its slot.
- During the wave, diving drones leave their slots, sweep down through the field,
  and either **loop back up** to re-enter formation or **exit through the bottom**
  (`y > 656`) and **re-appear from the top** to return to their slot. Movement is
  continuous through this wrap; nothing stops at an edge.

You design the lanes and paths; the constraints on them are in `specs/enemies.md`.

## Bullets

- **Player bullets** travel straight **up** the field; **enemy bullets** travel
  **down**. Their speeds and firing rules are in `specs/controls.md` (player) and
  `specs/enemies.md` (drones).
- **Every bullet carries a band** — cyan or magenta — fixed for its whole life,
  drawn in that band's color and glyph. A bullet's band is set when it is fired
  (the firer's band at that instant) and never changes in flight. What a bullet
  does on contact — destroy, be wasted, be absorbed, or cost a life — is defined
  entirely by the band-matching rules in `specs/polarity.md`.
- A bullet that leaves the play field is removed.

## HUD

The HUD occupies the strips above and below the play field (see the coordinate
system in `specs/overview.md`). It is always fully visible.

- **Top strip** (`y` in `[0, 64]`): the current **score** in large monospace
  digits (about `40 px` tall) toward the left, and the current **stage** label
  (e.g. `STAGE 2`) toward the right.
- **Bottom strip** (`y` in `[656, 720]`): the **remaining lives** shown as small
  ship icons toward the left; the **resonance meter** — a bar that fills as you
  build charge and glows when a discharge is ready (see `specs/polarity.md`) —
  in the center; and the **polarity indicator** toward the right: a bold swatch
  in your **current band's** color and glyph with its label (`CYAN` or
  `MAGENTA`), large enough to read at a glance, since your band is also your
  shield.

The polarity indicator and the ship's core color must always agree, so the
player can always tell — without looking away from the action — which band is
live.
