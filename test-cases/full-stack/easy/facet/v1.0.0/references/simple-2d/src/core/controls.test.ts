// Selecting, swapping, dragging, and the cursor (specs/controls.md).

import { describe, expect, it } from "vitest";
import { GEM_HIT_R, GRID_COLS, GRID_ROWS } from "../constants";
import { cellX, cellY, formatBoard } from "./board";
import {
  actOnCell,
  confirmCell,
  moveCursor,
  pointerDown,
  pointerMove,
  pointerUp,
} from "./controls";
import { loadBoard } from "./debug";
import { quietRowsWith } from "./fixtures";
import { createInitialState, type FacetState } from "./state";

const play = (edits: Readonly<Record<string, string>> = {}): FacetState =>
  loadBoard(createInitialState(1), quietRowsWith(edits));

/** The swap that drops a third ruby into (3, 4), making a row run of three. */
const ROW_RUN = { "3,3": "R0", "4,4": "R0" };

const press = (state: FacetState, col: number, row: number) =>
  pointerDown(state, cellX(col), cellY(row));

describe("the four rows of the selection table", () => {
  it("selects a cell while nothing is selected", () => {
    const acted = actOnCell(play(), { col: 3, row: 3 });
    expect(acted.state.selection).toEqual({ col: 3, row: 3 });
    expect(acted.events.select).toBe(true);
    expect(acted.requested).toBe(false);
  });

  it("clears the selection when the selected cell is acted on again", () => {
    const selected = actOnCell(play(), { col: 3, row: 3 }).state;
    const acted = actOnCell(selected, { col: 3, row: 3 });
    expect(acted.state.selection).toBeNull();
    expect(acted.events.select).toBe(false);
  });

  it("requests the swap of an orthogonally adjacent cell, and deselects", () => {
    const selected = actOnCell(play(ROW_RUN), { col: 3, row: 3 }).state;
    const acted = actOnCell(selected, { col: 3, row: 4 });
    expect(acted.requested).toBe(true);
    expect(acted.state.selection).toBeNull();
    expect(acted.state.phase).toBe("resolving");
    expect(acted.events.swap).toBe(true);
  });

  it("moves the selection to any other cell", () => {
    const selected = actOnCell(play(), { col: 0, row: 0 }).state;
    const acted = actOnCell(selected, { col: 5, row: 5 });
    expect(acted.state.selection).toEqual({ col: 5, row: 5 });
    expect(acted.events.select).toBe(true);
    expect(acted.requested).toBe(false);
  });

  it("does not treat a diagonal neighbor as adjacent", () => {
    const selected = actOnCell(play(), { col: 3, row: 3 }).state;
    const acted = actOnCell(selected, { col: 4, row: 4 });
    expect(acted.requested).toBe(false);
    expect(acted.state.selection).toEqual({ col: 4, row: 4 });
  });

  it("marks a refusal when the swap it requests is refused", () => {
    const selected = actOnCell(play(), { col: 3, row: 3 }).state;
    const acted = actOnCell(selected, { col: 3, row: 4 });
    expect(acted.state.refusal).toEqual({
      a: { col: 3, row: 3 },
      b: { col: 3, row: 4 },
    });
    expect(acted.events.refuse).toBe(true);
  });
});

describe("the pointer", () => {
  it("records the pointer whatever the screen", () => {
    const title = pointerDown(createInitialState(1), 100, 200).state;
    expect(title.pointer).toEqual({ x: 100, y: 200, down: true });
    expect(title.selection).toBeNull();
    expect(pointerUp(title).pointer.down).toBe(false);
  });

  it("selects the cell a press lands on", () => {
    const pressed = press(play(), 2, 6).state;
    expect(pressed.selection).toEqual({ col: 2, row: 6 });
    expect(pressed.pressedCell).toEqual({ col: 2, row: 6 });
  });

  it("changes nothing when the press is farther than GEM_HIT_R away", () => {
    const before = play();
    const pressed = pointerDown(before, 20, 20);
    expect(pressed.state.selection).toBeNull();
    expect(pressed.state.pressedCell).toBeNull();
    expect(pressed.state.pointer.down).toBe(true);
    expect(formatBoard(pressed.state.board)).toEqual(formatBoard(before.board));
  });

  it("presses a neighbor to swap, exactly as the table says", () => {
    const first = press(play(ROW_RUN), 3, 3).state;
    const second = press(first, 3, 4);
    expect(second.state.phase).toBe("resolving");
    expect(second.state.selection).toBeNull();
  });

  it("requests a swap by dragging onto an adjacent cell", () => {
    const pressed = press(play(ROW_RUN), 3, 3).state;
    const dragged = pointerMove(pressed, cellX(3), cellY(4));
    expect(dragged.state.phase).toBe("resolving");
    expect(dragged.state.selection).toBeNull();
    expect(dragged.state.dragSwapped).toBe(true);
    expect(dragged.events.swap).toBe(true);
  });

  it("requests at most one swap from one hold", () => {
    const pressed = press(play(ROW_RUN), 3, 3).state;
    const dragged = pointerMove(pressed, cellX(3), cellY(4)).state;
    const further = pointerMove(dragged, cellX(3), cellY(3));
    expect(formatBoard(further.state.board)).toEqual(
      formatBoard(dragged.board),
    );
    expect(further.events.swap).toBe(false);
  });

  it("does not drag from a press that targeted no cell", () => {
    const pressed = pointerDown(play(ROW_RUN), 20, 20).state;
    const dragged = pointerMove(pressed, cellX(3), cellY(4));
    expect(dragged.state.phase).toBe("idle");
    expect(dragged.state.pointer.x).toBe(cellX(3));
  });

  it("does not drag onto a cell that is not orthogonally adjacent", () => {
    const pressed = press(play(ROW_RUN), 3, 3).state;
    const dragged = pointerMove(pressed, cellX(5), cellY(5));
    expect(dragged.state.phase).toBe("idle");
    expect(dragged.state.dragSwapped).toBe(false);
  });

  it("does not drag while the pointer is up", () => {
    const released = pointerUp(press(play(ROW_RUN), 3, 3).state);
    const moved = pointerMove(released, cellX(3), cellY(4));
    expect(moved.state.phase).toBe("idle");
  });

  it("ends the drag on release", () => {
    const pressed = press(play(ROW_RUN), 3, 3).state;
    const released = pointerUp(pointerMove(pressed, cellX(3), cellY(4)).state);
    expect(released.pressedCell).toBeNull();
    expect(released.dragSwapped).toBe(false);
    expect(released.pointer.down).toBe(false);
  });

  it("targets the nearest center, and nothing beyond GEM_HIT_R", () => {
    // Inside the grid every point is within GEM_HIT_R of some center, since
    // GEM_HIT_R is half of CELL_PITCH; the margin around the board is not.
    const inside = pointerDown(play(), cellX(4) + GEM_HIT_R - 1, cellY(4));
    expect(inside.state.selection).toEqual({ col: 4, row: 4 });
    const beyond = pointerDown(play(), cellX(7) + GEM_HIT_R + 1, cellY(4));
    expect(beyond.state.selection).toBeNull();
    const above = pointerDown(play(), cellX(4), cellY(0) - GEM_HIT_R - 1);
    expect(above.state.selection).toBeNull();
  });
});

describe("the cursor", () => {
  it("moves one cell at a time and stays on the board", () => {
    const state = play();
    expect(moveCursor(state, 1, 0).cursor).toEqual({ col: 1, row: 0 });
    expect(moveCursor(state, 0, 1).cursor).toEqual({ col: 0, row: 1 });
    expect(moveCursor(state, -1, 0).cursor).toEqual({ col: 0, row: 0 });
    expect(moveCursor(state, 0, -1).cursor).toEqual({ col: 0, row: 0 });
  });

  it("stops at the far edges", () => {
    let state = play();
    for (let i = 0; i < 20; i++) state = moveCursor(state, 1, 1);
    expect(state.cursor).toEqual({
      col: GRID_COLS - 1,
      row: GRID_ROWS - 1,
    });
  });

  it("acts on the cursor's cell exactly as a press on it does", () => {
    const state = { ...play(ROW_RUN), cursor: { col: 3, row: 3 } };
    const selected = confirmCell(state).state;
    expect(selected.selection).toEqual({ col: 3, row: 3 });
    const moved = moveCursor(selected, 0, 1);
    const swapped = confirmCell(moved);
    expect(swapped.state.phase).toBe("resolving");
    expect(swapped.state.selection).toBeNull();
  });
});
