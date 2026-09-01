# Orrery — The editor

This file defines the screen a machine is built and run on: the layout of its
regions, the tray parts are taken from, selection and dragging on the field,
laying track, editing tapes, and the run controls. The input primitives and
the key bindings are in `specs/controls.md`, placement legality is in
`specs/parts.md`, and what a run does is in `specs/simulation.md`. Every
figure below carries the name this specification gives it.

## Layout

The editor divides the stage into five regions. The tray, the field, and the
tape panel are interactive, and their geometry is fixed because the pointer is
measured against it. The heading and the readout are display only, and their
internal layout is yours.

| Region | Extent | Holds |
| --- | --- | --- |
| Heading | `y` `0` to `HEADING_H` (`48`) | The challenge's name, the machine's current cost, and room for the editor's messages. |
| Tray | `x` `0` to `TRAY_REGION_W` (`224`), `y` `48` to `720` | One slot per available part. |
| Field | `x` `224` to `1008`, `y` `48` to `560` | The hex field of `specs/field.md`, drawn at its fixed geometry. |
| Readout | `x` `READOUT_X0` (`1008`) to `1280`, `y` `48` to `560` | The run's live figures. |
| Tape panel | `x` `224` to `1280`, `y` `TAPE_Y0` (`560`) to `720` | One row per arm and wheel. |

The heading shows the challenge's name and the machine's cost, updated as
parts come and go, and carries the editor's messages, such as the refusal to
run below. During a run the readout shows at least the status, the cycle
count, the period, the speed step, and each set's tally against the
challenge's `target`; while editing it may rest. Both regions' styling and
arrangement are the build's own.

## The tray

The tray offers what the challenge permits. Its entries are, in order: the
challenge's `permitted` part kinds, in the order of `PARTS` in
`specs/parts.md`; then one `rise` per reagent, in reagent order; then one
`set` per product, in product order. A challenge offers at most `TRAY_MAX`
(`16`) entries.

Entry `k`, counted from `0`, occupies the rectangle from `(TRAY_X0, TRAY_Y0 +
k * TRAY_SLOT_H)` to `(TRAY_X0 + TRAY_W, TRAY_Y0 + (k + 1) * TRAY_SLOT_H)`,
with `TRAY_X0` `8`, `TRAY_Y0` `56`, `TRAY_SLOT_H` `30`, and `TRAY_W` `208`.
Each entry shows the part's name and its cost from `PART_COSTS`; a rise or
set entry shows which reagent or product it is. Presses are targeted by these
rectangles: a press inside entry `k` begins placing that part.

A rise or set entry is spent once its part is on the field: it reads as
spent, and a press on it does nothing until the placed part is deleted. Every
other entry places any number of copies. A press in the tray outside every
entry does nothing beyond setting the focus.

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
it one rotation step, `part-grow` and `part-shrink` change an arm's length
within `ARM_MIN_LEN` (`1`) to `ARM_MAX_LEN` (`3`), and `part-delete` removes
it. A rotation or length change that would make the placement illegal under
`specs/parts.md` does not happen. Rotation does nothing on a track, and
length does nothing on a track or a wheel.

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
  translates by it, a track's path included, so the hex under the pointer is
  the one that was grabbed. Releasing on the starting hex commits no move;
  releasing elsewhere moves the part by the offset when the result is legal,
  and leaves it in place when it is not. Either way the part stays selected,
  and a rotation or length change made on the ghost is kept.
- A release while no hex is targeted commits no move and leaves the part in
  place, selected. A tray drag released the same way places nothing.
- Arms, wheels, and tracks keep their tapes and mounting relationships are
  re-derived from position, as `specs/parts.md` states.

While a drag or lay is live, `part-delete`, `undo`, `redo`, `play`, and
`step` do nothing: a drag ends only at its release.

Deleting or moving a part never touches any other part. Deleting a track
deletes its whole path; deleting an arm or wheel discards its tape and its
row.

## Laying track

A press on an end cell of an open track begins laying rather than moving.
While laying, moving the pointer onto a hex adjacent to the live end appends
it to the path when the placement rules allow, and that hex becomes the live
end; moving back onto the cell just behind the live end removes the end cell.
Moving onto the path's other end closes the track into a loop and ends the
lay. The release ends the lay, leaving the path as laid.

Removal outranks closing: on a two-cell path the cell behind the live end is
the other end, and moving onto it removes the end cell rather than closing,
so a track closes only with at least three cells in the loop, as the
placement rules require. A one-cell track's only
cell is both its ends, so a press on it always begins laying, recorded from
the `last` end; it is repositioned by laying it longer or by deleting and
replacing it.

A closed track has no end cells, so its cells only move the track. Removing
cells from a closed track is done by deleting and relaying it.

## The tape panel

The panel shows one row per arm and wheel, in placement order. Row heights
and cell widths are fixed because presses are measured against them:

| Constant | Value | Meaning |
| --- | --- | --- |
| `TAPE_ROW_H` | `28` | Height of a row. |
| `TAPE_ROWS_VISIBLE` | `5` | Rows shown at once. |
| `TAPE_LABEL_W` | `80` | Width of the label at a row's left edge. |
| `TAPE_X0` | `88` | Offset from the panel's left edge (`224`) to cell `0`'s column, so cells begin at stage `x` `312`. |
| `TAPE_CELL_W` | `24` | Width of a cell. |
| `TAPE_COLS_VISIBLE` | `40` | Cell columns shown at once. |

Visible row `v`, from `0` to `4`, spans `y` `TAPE_Y0 + v * TAPE_ROW_H` to
`TAPE_Y0 + (v + 1) * TAPE_ROW_H` and shows the arm at index `firstRow + v` in
placement order. Visible column `u` spans `x` `224 + TAPE_X0 + u *
TAPE_CELL_W` onward and shows cell `firstCol + u`. The two scroll positions
are derived, so the panel follows the work:

- `firstRow = max(0, selectedRow - (TAPE_ROWS_VISIBLE - 1))`, where
  `selectedRow` is the cursor's arm's index in placement order, and `0` with
  no cursor.
- `firstCol = max(0, cursor.col - (TAPE_COLS_VISIBLE - 1))`, and `0` with no
  cursor.

Each row's label names its arm well enough to find it on the field, and the
build draws a matching mark on the part itself. Each cell shows its
instruction as a compact glyph of the build's own design, with the ten
instructions distinguishable; a blank cell reads as blank. The cursor's cell
is visibly marked, and each row is annotated with its tape length against the
machine's period.

A press inside a cell rectangle points the cursor at that row's arm and that
column, and sets the focus to `tape`; a press inside a row's label points at
that row, column `0`; a press in the panel that lands on no row or cell sets
the focus and leaves the cursor as it is. The tape-focus actions then edit at
the cursor, as `specs/controls.md` lists: each instruction action writes its
instruction at the cursor and moves the cursor one cell right; `ins-blank`
blanks the cell in place; `ins-erase` blanks the cell before the cursor and
moves back one, and does nothing at column `0`; `ins-reset` and `ins-repeat`
write their macro's expansion from `specs/instructions.md` and land the
cursor after it. `up` and `down` move the cursor between rows, wrapping, and
`left` and `right` move it by one cell, stopping at `0`. A tape has no fixed
end: writing past the last cell lengthens it, and the cells between hold
blanks.

## Undo and redo

Every committed edit to the machine pushes one entry onto the undo history:
placing, moving, or deleting a part, ending a lay that changed a track,
rotating or resizing a part, and each write to a tape, the macros counting as
one edit apiece. An edit that changes nothing, such as writing the
instruction a cell already holds, commits nothing and pushes no entry. The
entry holds the machine as it stood before the edit: the parts with their
poses, paths, and tapes. Selection, cursor, focus, and drags are not part of
history.

The `undo` action restores the machine from the latest entry and moves that
edit onto the redo side; `redo` re-applies the latest undone edit. A new
committed edit clears the redo side. Both act only while editing, do nothing
with empty history, and reach back through this visit's edits to the machine
the visit began with; histories are not part of the per-challenge stash.
Undoing never changes which challenge is open or any progress or record. An
edit, undo, or redo that removes the selected part clears the selection, and
one that removes the cursor's arm clears the cursor.

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
`back` stops the run and returns to editing from any status.

While a run is active, in any status, every editing surface is locked: field
and tape presses select nothing and change no cursor, though they still set
the focus, drags do not begin, and the field-focus and tape-focus actions do
nothing. The machine, the motes, and the arms' live poses are drawn on the
field as the run leaves them each frame, motion interpolated smoothly along
the same paths the collision rule samples.

## Entering and leaving

Opening a challenge from a select screen shows this editor with that
challenge's tray. The first visit in a session opens an empty field; leaving
by any route keeps the machine, and every later visit in the session restores
it exactly, tapes included. Progress on one challenge never appears on
another. Machines are kept for the session only.
