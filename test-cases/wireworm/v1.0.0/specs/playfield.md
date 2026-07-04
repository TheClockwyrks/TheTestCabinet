# Playfield

## Overview

This file defines the geometry of the board: the tile grid, the node field, the
player band the cursor is confined to, where the worm enters, and the HUD bar. It
uses the coordinate system and palette from `specs/overview.md`. The signature
charge rules live in `specs/charge.md`, the worm in `specs/worm.md`, the foes in
`specs/foes.md`.

## The stage: HUD bar and board

The `1280 x 720` stage is split into two regions, stacked:

- **HUD bar** — `x` in `[0, 1280]`, `y` in `[0, 80]`, full width, 80 px tall. It
  holds the score, lives, level, and status readouts (below and `specs/flow.md`).
- **Board** — `x` in `[0, 1280]`, `y` in `[80, 720]`, full width, 640 px tall.
  All play happens here.

## The tile grid

The board is a grid of **32 x 32** logical-pixel tiles, **40 columns x 20 rows**
(`1280 x 640`).

- Column `c` (`0..39`) spans `x` in `[32c, 32c + 32]`; row `r` (`0..19`) spans
  `y` in `[80 + 32r, 80 + 32r + 32]`. Tile `(c, r)`'s top-left corner is at
  `(32c, 80 + 32r)` and its center at `(32c + 16, 80 + 32r + 16)`.
- A faint trace grid marks the tiles (`specs/overview.md`).
- Row `0` is the **top row** where the worm enters; row `19` is the **bottom
  row**, the floor.

Each tile holds at most one **node**, and each **worm segment** occupies one
tile. The cursor and the foes move in logical-pixel space over the grid, not
snapped to it.

## The node field

Nodes are the terrain — the capacitor components the worm winds through and you
charge and detonate (`specs/charge.md`). Each node fills one tile.

- **Starting field.** A new game starts the board with a **scattering of inert
  (charge 0) nodes** — roughly `10%–15%` of the tiles, placed at random in the
  upper and middle rows (about rows `1..15`), never in the top row `0` (kept clear
  for the worm's entry) and never in the bottom **player band** (below). The exact
  scatter is yours to design; it must not be the same fixed layout every game.
- **The field grows as you play.** Every worm segment destroyed by a **shot**
  leaves a fresh inert node in the tile where it died (`specs/worm.md`), so the
  field thickens over a level. Segments destroyed by a **discharge** leave no node
  (`specs/charge.md`). The packet-dropper also seeds nodes (`specs/foes.md`).
- **The field persists across levels.** Clearing a level does not reset the board;
  the nodes standing at the end of one level are the field the next level's worm
  descends through (`specs/flow.md`), so late levels are denser and more
  dangerous.
- Nodes are only ever removed by your shots or a discharge
  (`specs/charge.md`), by
  a glitch eating them, or by losing a life (`specs/foes.md`, `specs/flow.md`).
  They do not decay on their own.

## The player band

The cursor is confined to a shallow **player band** at the bottom of the board:
the **bottom 5 rows**, rows `15..19` — `y` in `[560, 720]`, `160` px tall, full
width. The band reads as a subtly tinted floor (`specs/overview.md`).

- The cursor moves **freely in logical pixels** within this band — left/right
  across the full width and up/down within the five rows — never snapped to tiles,
  and never leaving the band (`specs/controls.md`).
- **No node ever occupies the player band by normal growth**: a worm segment that
  dies in the band from a shot still leaves its node (nodes can exist in the band),
  but the *starting* scatter and the dropper keep out of it. Practically, the band
  starts clear so the cursor has room, and only fills if you shoot the worm down
  low.
- The band is where the danger resolves: a worm segment or a foe that reaches the
  cursor costs a life (`specs/flow.md`).

## Where the worm enters

The worm enters along the **top row** (row `0`), from the left or right edge, and
winds downward from there (`specs/worm.md`). The top row is kept clear of the
starting node scatter so the worm has room to enter and begin its first pass.

## The HUD bar

The HUD bar (`y` in `[0, 80]`) carries the status readouts, laid out across the
full width (exact styling is yours, matching `specs/overview.md` and the
reference image):

- **SCORE** — the running score (`specs/flow.md`), the most prominent readout.
- **LIVES** — the cursor lives remaining, shown as a small row of cursor icons
  (or a count).
- **LEVEL** — the current level as `LEVEL n / 12` (`specs/flow.md`).
- A compact **hazard/next indicator** is encouraged — for example a small note
  when a corruptor or dropper is active (`specs/foes.md`) — but not required.

The HUD bar must always be fully visible, above the board, at every window size
(`specs/overview.md`). On the board itself, worm segments and foes carry no health
bars (most die in one hit; the exceptions are noted in `specs/foes.md`), and nodes
show their charge by their sprite (`specs/charge.md`, `specs/assets.md`).
