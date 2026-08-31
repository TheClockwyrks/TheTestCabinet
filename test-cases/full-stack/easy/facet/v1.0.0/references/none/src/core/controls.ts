// Facet — selecting, swapping, and the cursor (specs/controls.md).
//
// The pointer and the keyboard reach the board through ONE table: the four rows
// under `## Selecting and swapping`, evaluated in order, first match wins.
// `actOnCell` is that table, and a press, a `confirm` on the cursor's cell, and
// a posed press all run through it, so the three cannot drift apart.
//
// Nothing here touches a DOM event. The runtime layer above reports a pointer
// position in logical stage units and the press and release edges, and this
// module says what the game does with them.

import { GRID_COLS, GRID_ROWS } from "../constants";
import { orthogonallyAdjacent, sameCell, targetCell } from "./board";
import { requestSwap } from "./chain";
import {
  NO_EVENTS,
  quiet,
  type Cell,
  type FacetState,
  type Stepped,
} from "./state";

/** What acting on a cell did, and whether it asked for a swap. */
export interface CellAction extends Stepped {
  /** A hold requests at most one swap, so the drag needs to know. */
  readonly requested: boolean;
}

/**
 * The four rows of `specs/controls.md`, in order:
 *
 *   1. any cell, while nothing is selected — selects that cell;
 *   2. the selected cell — clears the selection;
 *   3. a cell orthogonally adjacent to the selection — requests that swap and
 *      clears the selection;
 *   4. any other cell — moves the selection to that cell.
 */
export function actOnCell(state: FacetState, cell: Cell): CellAction {
  const selection = state.selection;
  if (!selection) {
    return {
      state: { ...state, selection: cell },
      events: { ...NO_EVENTS, select: true },
      requested: false,
    };
  }
  if (sameCell(selection, cell)) {
    return { ...quiet({ ...state, selection: null }), requested: false };
  }
  if (orthogonallyAdjacent(selection, cell)) {
    const swapped = requestSwap(state, { a: selection, b: cell });
    return {
      state: { ...swapped.state, selection: null },
      events: swapped.events,
      requested: true,
    };
  }
  return {
    state: { ...state, selection: cell },
    events: { ...NO_EVENTS, select: true },
    requested: false,
  };
}

// ---- The cursor ----------------------------------------------------------

/**
 * The cursor moved by one cell, clamped to the board, so a movement that would
 * carry it off an edge leaves it where it is.
 */
export function moveCursor(
  state: FacetState,
  dCol: number,
  dRow: number,
): FacetState {
  const cursor = {
    col: Math.min(Math.max(state.cursor.col + dCol, 0), GRID_COLS - 1),
    row: Math.min(Math.max(state.cursor.row + dRow, 0), GRID_ROWS - 1),
  };
  return { ...state, cursor };
}

/** `confirm` on the board: the same four rows, read against the cursor's cell. */
export function confirmCell(state: FacetState): Stepped {
  const acted = actOnCell(state, state.cursor);
  return { state: acted.state, events: acted.events };
}

// ---- The pointer ---------------------------------------------------------

/**
 * A press. The pointer is recorded whatever the screen, because the snapshot
 * reports it on every screen, but only `playing` carries a board to press on.
 *
 * A press farther than `GEM_HIT_R` from every cell center targets no cell and
 * changes nothing beyond the pointer itself — which is exactly the press a
 * validator uses to unlock audio without disturbing the board.
 */
export function pointerDown(state: FacetState, x: number, y: number): Stepped {
  const pressed: FacetState = {
    ...state,
    pointer: { x, y, down: true },
    pressedCell: null,
    dragSwapped: false,
  };
  if (pressed.screen !== "playing") return quiet(pressed);

  const cell = targetCell(pressed.board, x, y);
  if (!cell) return quiet(pressed);

  const acted = actOnCell(pressed, cell);
  return {
    state: {
      ...acted.state,
      pressedCell: cell,
      dragSwapped: acted.requested,
    },
    events: acted.events,
  };
}

/**
 * A move. While the pointer is held down from a press that targeted a cell,
 * moving within `GEM_HIT_R` of the center of a cell orthogonally adjacent to
 * the pressed one requests that swap and clears the selection. A hold requests
 * at most one swap, so the rest of it changes nothing.
 */
export function pointerMove(state: FacetState, x: number, y: number): Stepped {
  const moved: FacetState = { ...state, pointer: { ...state.pointer, x, y } };
  if (
    moved.screen !== "playing" ||
    !moved.pointer.down ||
    !moved.pressedCell ||
    moved.dragSwapped
  ) {
    return quiet(moved);
  }

  const cell = targetCell(moved.board, x, y);
  if (!cell || !orthogonallyAdjacent(moved.pressedCell, cell)) {
    return quiet(moved);
  }

  const swapped = requestSwap(moved, { a: moved.pressedCell, b: cell });
  return {
    state: { ...swapped.state, selection: null, dragSwapped: true },
    events: swapped.events,
  };
}

/** A release, which ends the drag whatever it did. */
export function pointerUp(state: FacetState): FacetState {
  return {
    ...state,
    pointer: { ...state.pointer, down: false },
    pressedCell: null,
    dragSwapped: false,
  };
}
