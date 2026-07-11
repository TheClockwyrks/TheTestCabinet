# Coil — Wrap mode

This file defines this build's one playable mode, **Wrap**, and its main-menu
entry. It builds on the board in `specs/playfield.md`, the simulation in
`specs/mechanics.md`, and the scoring and flow in `specs/flow.md`.

## Menu entry

This spec adds the following entry to the main menu (see Game states in
`specs/flow.md`), before `HOW TO PLAY`:

- `WRAP`

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a mode, and is always
shown last in the menu.)

## Wrap

- **Wrap** — the game on the `30 x 18` board from `specs/playfield.md`, but the
  four perimeter edges become **tunnels** instead of solid walls. A snake that
  leaves one edge re-enters from the opposite edge on the same row or column. This
  removes wall death entirely and changes the strategy: the board has no corners
  to be trapped in, so the only thing that can kill the snake is its own body.

Wrap uses the 125 ms tick interval (`specs/mechanics.md`), the standard
single-pellet placement (`specs/playfield.md`), the combo scoring
(`specs/mechanics.md` and `specs/flow.md`), and the standard growth and body/tail
collision rules — with the board changes below.

### Board changes

- The interior playable area is the **full** `30 x 18` grid: `col` in `[0, 29]`
  and `row` in `[0, 17]`. There is no one-cell wall border; the perimeter cells
  are playable.
- Render the four edges as open **tunnel** boundaries rather than the solid wall
  border — for example a dashed or gapped frame in the wall-border color — so it
  is visually clear the edges are passable, not lethal. The board interior and
  grid are otherwise drawn as described in `specs/playfield.md`.
- Pellets (and the snake's start position) use this full grid: a valid pellet
  cell is any cell not occupied by the snake or another pellet. The snake still
  starts length 3 at head `(15, 8)`, body `(14, 8)`, tail `(13, 8)`, facing
  right.

### Wrapping

When the head advances off an edge, it reappears on the opposite edge of the
same line, computed on the full grid:

- `col` wraps modulo `30`: moving left from `col = 0` arrives at `col = 29`;
  moving right from `col = 29` arrives at `col = 0`.
- `row` wraps modulo `18`: moving up from `row = 0` arrives at `row = 17`;
  moving down from `row = 17` arrives at `row = 0`.

Apply the wrap when computing the new head cell (step 2 of the tick in
`specs/mechanics.md`), so the wrapped cell is the cell that collision, eating,
and movement all use. There is **no** wall-collision case in Wrap; the only fatal
collision is the snake's own body, with the same tail rule as in
`specs/mechanics.md`.
