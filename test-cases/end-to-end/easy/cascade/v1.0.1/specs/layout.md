# Layout

## Overview

This file defines the geometry of the table and every pile on it. All positions
and sizes are in the logical-pixel coordinate system defined in `specs/overview.md`
(a fixed `1280 x 720` table, origin top-left). The rules of play for these piles
are in `specs/rules.md`.

## Cards

- Every card occupies a **`100 x 140`** rectangle (corner radius `8`). This is
  the card's footprint wherever it sits — in a pile slot, overlapped in a column,
  in the hand while dragging, or in flight during the win cascade.
- A card is either **face-up** (rank and suit visible) or **face-down** (back
  shown). The rendering of each is described under Visual design in
  `specs/overview.md`.

## Piles

The table holds thirteen piles split into two rows: a top row of the stock, the
waste, and the four foundations; and the seven tableau columns below.

### Seven Column Anchors

The seven tableau columns are evenly spaced across the table with a **pitch of
122** (a `100`-wide card plus a `22` gap), and the group is centered, so the
column left edges are at these `x` values:

| Column | 1   | 2   | 3   | 4   | 5   | 6   | 7   |
| ------ | --- | --- | --- | --- | --- | --- | --- |
| `x`    | 224 | 346 | 468 | 590 | 712 | 834 | 956 |

The top row's piles align to these same columns so the table reads as a grid.

### Top Row

The top row begins at `y = 24` and has a height of `140` with the following
piles:

- **Stock** — at column 1 (`x = 224`). The face-down draw pile. Clicking it turns
  cards to the waste (see `specs/rules.md` and `specs/deal-mode.md`).
- **Waste** — at column 2 (`x = 346`). The face-up pile that the stock turns onto;
  only its top card is playable. When the stock turns more than one card at a time,
  the most recent few are fanned to the right (see `specs/deal-mode.md`); the fan stays
  clear of the stock and does not overlap the foundations.
- **Foundations** — four slots at columns 4–7 (`x = 590, 712, 834, 956`). Each
  builds one suit up from Ace to King. An empty foundation shows a dim suit-pip
  hint, but any suit may be started on any empty foundation.

The gap at column 3 separates the draw piles on the left from the foundations on
the right.

### Tableau

Below the top row are the tableau columns with the following attributes:

- The seven columns begin at **`y = 180`**, each at its column `x` above.
- Cards in a column **overlap downward**, offset from the card above by:
  - **`24`** when the card above it is **face-down**;
  - **`34`** when the card above it is **face-up**.
  This keeps every face-down card's edge and every face-up card's rank corner
  visible while the columns stay compact.
- An **empty column** shows its slot outline at its anchor (`y = 180`).

### The HUD strip

The row below the tableau, from about **`y = 684` to `y = 712`**, is reserved for
the HUD controls (`specs/flow.md`); tableau columns must stay clear of it (see
compression below). It holds the New Game and Menu controls and the deal-mode
label.

### Long-column compression

A column may grow long (a full descending run stacked on its original face-down
cards). A column's cards must always stay within the table and clear of the HUD
strip: the bottom card's lower edge may not fall below **`y = 676`**. If a
column's natural extent at the offsets above would exceed that, **reduce the
face-up offset uniformly** for that column (down to a floor of **`14`**) so the
whole column fits, keeping every card's rank corner visible. The face-down offset
is not compressed. This is a per-column, per-frame fit, so a column expands back
to the normal offsets as cards leave it.
