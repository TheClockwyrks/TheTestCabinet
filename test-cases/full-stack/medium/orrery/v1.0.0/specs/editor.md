# Orrery — The editor

This file defines the screen a machine is built and run on: the layout of its
regions, the tray parts are taken from, selection and dragging on the field,
laying track, editing tapes, and the run controls. The input primitives and
the key bindings are in `specs/controls.md`, placement legality is in
`specs/parts.md`, and what a run does is in `specs/simulation.md`. Every
figure below carries the name this specification gives it.

## Layout

The editor divides the stage into five regions. The tray, the field, and the
tape panel are interactive and carry the fixed geometry below. The heading and
the readout are display only, and their internal layout is yours.

| Region | Extent | Holds |
| --- | --- | --- |
| Heading | `x` `0` to `STAGE_W` (`1280`), `y` `0` to `HEADING_H` (`48`) | The challenge's name, the machine's current cost, and the editor's messages. |
| Tray | `x` `0` to `TRAY_REGION_W` (`224`), `y` `HEADING_H` (`48`) to `STAGE_H` (`720`) | One slot per available part. |
| Field | `x` `TRAY_REGION_W` (`224`) to `READOUT_X0` (`1008`), `y` `HEADING_H` (`48`) to `TAPE_Y0` (`560`) | The hex field of `specs/field.md`, drawn at its fixed geometry. |
| Readout | `x` `READOUT_X0` (`1008`) to `STAGE_W` (`1280`), `y` `HEADING_H` (`48`) to `TAPE_Y0` (`560`) | The run's live figures. |
| Tape panel | `x` `TRAY_REGION_W` (`224`) to `STAGE_W` (`1280`), `y` `TAPE_Y0` (`560`) to `STAGE_H` (`720`) | One row per arm and wheel. |

Every extent above, and every rectangle this file fixes, includes its lower
bound and excludes its upper, so a point on a shared edge belongs to the
region below and to the right of it.

During a run the readout shows at least the status, the cycle count, the
period, the speed step, and each set's tally against the challenge's `target`;
while editing it may rest.

## The tray

The tray offers what the challenge permits. Its entries are, in order: the
challenge's `permitted` part kinds, in the order of `PARTS` in
`specs/parts.md`; then one `rise` per reagent, in reagent order; then one
`set` per product, in product order. `specs/formats.md` bounds how many
entries a challenge's tray holds.

Entry `k`, counted from `0`, occupies the rectangle from `(TRAY_X0, TRAY_Y0 +
k * TRAY_SLOT_H)` to `(TRAY_X0 + TRAY_W, TRAY_Y0 + (k + 1) * TRAY_SLOT_H)`,
with `TRAY_X0` `8`, `TRAY_Y0` `56`, `TRAY_SLOT_H` `30`, and `TRAY_W` `208`.
Each entry shows the part's name and its cost from `PART_COSTS`; a rise or
set entry shows which reagent or product it is. An entry may reuse the
produced part art `specs/assets.md` lists, and how it is arranged inside its
rectangle is yours. Presses are targeted by these rectangles: a press inside
entry `k` begins placing that part.

A rise or set entry is spent once its part is on the field: it is drawn
visibly distinct from an unspent entry, and a press on it does nothing until
the placed part is deleted. Every other entry places any number of copies. A
press in the tray outside every entry does nothing beyond setting the focus.

## Selection on the field

A press on the field targets a hex by the rule in `specs/field.md`. When
parts share the hex, the topmost is taken: an arm or wheel anchored there,
else a track with that cell, else the sigil whose footprint covers it. The
press selects that part; a press on a bare hex, or off every part, clears the
selection. At most one part is selected, and the selected part is drawn
visibly distinct.

Selecting an arm or wheel also points the tape cursor at its row, cell `0`,
leaving the focus on the field. The field-focus actions of
`specs/controls.md` act on the selected part: `part-cw` and `part-ccw` turn
an arm, a wheel, or a sigil one rotation step; `part-grow` and `part-shrink`
change an arm's length within the bounds `specs/parts.md` fixes; and
`part-delete` removes any part. A rotation or length change that would make
the placement illegal under `specs/parts.md` does not happen.

## Dragging

Placing and moving run through one drag shape: a press begins it, each
pointer move retargets it, and the release commits or cancels it. While a
drag is live a ghost of the part is drawn at the targeted hex, visibly legal
or illegal under the placement rules, and `part-cw`, `part-ccw`, `part-grow`,
and `part-shrink` act on the ghost.

- From the tray: the ghost is a new part at the targeted hex, at rotation `0`
  and length `1`. Releasing on a legal hex places it and selects it;
  releasing anywhere else places nothing. A `track` entry places a single
  open cell.
- From the field: a press on a part selects it at once and begins a move. The
  drag's offset is the targeted hex minus the pressed hex, and the whole part
  translates by it, a track's path included. Releasing on the starting hex
  commits no move; releasing elsewhere moves the part by the offset when the
  result is legal, and leaves it in place when it is not. Either way the part
  stays selected, and a rotation or length change made on the ghost is kept.
- A release while no hex is targeted commits no move and leaves the part in
  place, selected. A tray drag released the same way places nothing.
- Arms and wheels keep their tapes, and mounting relationships are re-derived
  from position, as `specs/parts.md` states.

While a drag or lay is live the only actions the editor reads are `part-cw`,
`part-ccw`, `part-grow`, and `part-shrink`, which act on the ghost, and
`mute`. A drag ends at its release.

An edit changes the edited part alone. Deleting a track deletes its whole
path; deleting an arm or wheel discards its tape and its row.

## Laying track

A press on an end cell of an open track begins laying rather than moving.
While laying, moving the pointer onto a hex adjacent to the live end appends
it to the path when the placement rules allow, and that hex becomes the live
end; moving back onto the cell just behind the live end removes the end cell.
Moving onto the path's other end closes the track into a loop and ends the
lay. The release ends the lay, leaving the path as laid.

Removal outranks closing, so a path of two cells is shortened rather than
closed. A press on a one-cell track begins laying from its `last` end.

A press on any cell of a closed track begins a move.

## The tape panel

The panel shows one row per arm and wheel, in placement order. Row heights
and cell widths are fixed:

| Constant | Value | Meaning |
| --- | --- | --- |
| `TAPE_ROW_H` | `28` | Height of a row. |
| `TAPE_ROWS_VISIBLE` | `5` | Rows shown at once. |
| `TAPE_LABEL_W` | `80` | Width of the label at a row's left edge. |
| `TAPE_X0` | `88` | Offset from the panel's left edge to cell `0`'s column. |
| `TAPE_CELL_W` | `24` | Width of a cell. |
| `TAPE_COLS_VISIBLE` | `40` | Cell columns shown at once. |

A row's label spans `x` `TRAY_REGION_W` (`224`) to
`TRAY_REGION_W + TAPE_LABEL_W` (`304`) across its row's full height, and the
columns begin at `TRAY_REGION_W + TAPE_X0` (`312`).

Visible row `v`, from `0` to `4`, spans `y` `TAPE_Y0 + v * TAPE_ROW_H` to
`TAPE_Y0 + (v + 1) * TAPE_ROW_H` and shows the arm at index `firstRow + v` in
placement order. Visible column `u` spans `x`
`TRAY_REGION_W + TAPE_X0 + u * TAPE_CELL_W` onward and shows cell
`firstCol + u`. The two scroll positions are derived:

- `firstRow = max(0, selectedRow - (TAPE_ROWS_VISIBLE - 1))`, where
  `selectedRow` is the cursor's arm's index in placement order, and `0` with
  no cursor.
- `firstCol = max(0, cursor.col - (TAPE_COLS_VISIBLE - 1))`, and `0` with no
  cursor.

Each row's label carries an identifier unique among the machine's rows, and
the same identifier is drawn on that part on the field. Each cell shows its
instruction as the produced glyph `specs/assets.md` names for it, drawn at
native size, with the ten instructions of `specs/instructions.md`
distinguishable at `TAPE_CELL_W` (`24`); a blank cell is drawn empty. The
cursor's cell is visibly marked, and each row is annotated with its tape
length against the machine's period.

A press inside a cell rectangle points the cursor at that row's arm and that
column; a press inside a row's label points it at that row, column `0`; a
press in the panel that lands on no row or cell leaves the cursor as it is.
Every press in the panel sets the focus, as `specs/controls.md` states.

The tape-focus actions of `specs/controls.md` then edit at the cursor:

- Each instruction action writes its instruction at the cursor and moves the
  cursor one cell right.
- `ins-blank` blanks the cell in place.
- `ins-erase` blanks the cell before the cursor and moves back one, and does
  nothing at column `0`.
- `ins-reset` writes the `reset` expansion of `specs/instructions.md` and
  lands the cursor after it.
- `ins-repeat` writes the `repeat` expansion of `specs/instructions.md` and
  lands the cursor after it.
- `up` and `down` move the cursor between rows, wrapping at both ends, and
  `left` and `right` move it by one cell, stopping at `0` and moving without
  an upper bound.

A tape has no fixed end: writing past the last cell lengthens it, and the
cells between hold blanks.

## Undo and redo

Every committed edit to the machine pushes one entry onto the undo history:
placing, moving, or deleting a part, ending a lay that changed a track,
rotating or resizing a part, and each write to a tape, the macros counting as
one edit apiece. An edit that changes nothing, such as writing the
instruction a cell already holds, commits nothing and pushes no entry. The
entry holds the machine as it stood before the edit: the parts with their
poses, paths, and tapes. Selection, cursor, focus, and drags are not part of
history. The history holds every edit of the visit, with no bound on its
depth.

The `undo` action restores the machine from the latest entry and moves that
edit onto the redo side; `redo` re-applies the latest undone edit. A new
committed edit clears the redo side. Both act only while editing and on the
open challenge's machine alone, do nothing with empty history, and reach back
through this visit's edits to the machine the visit began with; histories are
not part of the per-challenge stash. An edit, undo, or redo that removes the
selected part clears the selection, and one that removes the cursor's arm
clears the cursor.

## Running the machine

The `play` action starts a run when every rise and every set is placed;
otherwise it does nothing and the heading states which are missing. `step`
under the same condition starts the run paused at its settle. After that,
`step` acts immediately and always leaves the run paused: a run mid-cycle,
running or paused, completes its current cycle to the boundary, and a run
paused at a boundary runs one full cycle, as `specs/simulation.md` defines
one. While the status is `running` or `paused`, `play` toggles between the
two and `speed-up` and `speed-down` move the speed step; while it is
`faulted` or `complete`, `play`, `step`, and the speed actions do nothing.
`back` stops the run and returns to editing from any status, as
`specs/simulation.md` states.

While a run is active, in any status, a press on the field or the tape panel
sets the focus alone, and the editor reads the run controls above and `mute`
and nothing else. The solved panel of `specs/ui.md` reads its own menu while
it is up. The machine, the motes, and the arms' live poses are drawn on the
field as the run leaves them each frame, motion interpolated smoothly along
the same paths the collision rule samples.

## Entering and leaving

Opening a challenge from a select screen shows this editor with that
challenge's tray, and `back` while editing returns to that select screen. The
first visit in a session opens an empty field; leaving by any route keeps the
machine, and every later visit in the session restores it exactly, tapes
included. Each challenge carries its own machine and its own records. Machines
are kept for the session only.
