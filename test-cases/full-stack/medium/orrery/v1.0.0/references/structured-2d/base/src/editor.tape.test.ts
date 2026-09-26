import { describe, expect, it } from "vitest";

import {
  TAPE_CELL_W,
  TAPE_ROW_H,
  TAPE_Y0,
  TRAY_REGION_W,
  type ActionName,
} from "./constants";
import { parseChallenge } from "./formats";
import { Bench } from "./harness";
import { hexX, hexY } from "./hex";
import { startRun } from "./sim";
import { TAPE_COL_X0 } from "./tapepanel";
import type { PartState } from "./types";
import {
  enterFromSelect,
  enterScreen,
  handleAction,
  handlePointer,
  loadChallenge,
  openChallenge,
} from "./flow";

/** A challenge offering an arm, a wheel, and a track. */
function bench(): Bench {
  const game = new Bench();
  loadChallenge(
    game,
    parseChallenge({
      name: "Tapes",
      reagents: [{ motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] }],
      products: [{ motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] }],
      permitted: ["arm", "wheel", "track", "bind"],
      target: 6,
    }),
  );
  return game;
}

function parts(game: Bench): PartState[] {
  return game.state.editor.parts;
}

/** Place `count` arms along `r = 0`, in placement order. */
function arms(game: Bench, count: number): void {
  for (let i = 0; i < count; i += 1) {
    handlePointer(game, { type: "down", x: 12, y: 60 });
    handlePointer(game, { type: "move", x: hexX(i - 2, 0), y: hexY(i - 2, 0) });
    handlePointer(game, { type: "up", x: hexX(i - 2, 0), y: hexY(i - 2, 0) });
  }
}

/** Press visible row `v`, visible column `u`, of the tape panel. */
function pressCell(game: Bench, v: number, u: number): void {
  const x = TAPE_COL_X0 + u * TAPE_CELL_W + 2;
  const y = TAPE_Y0 + v * TAPE_ROW_H + 2;
  handlePointer(game, { type: "down", x, y });
  handlePointer(game, { type: "up", x, y });
}

/** Press visible row `v`'s label. */
function pressLabel(game: Bench, v: number): void {
  const y = TAPE_Y0 + v * TAPE_ROW_H + 2;
  handlePointer(game, { type: "down", x: TRAY_REGION_W + 4, y });
  handlePointer(game, { type: "up", x: TRAY_REGION_W + 4, y });
}

/** Press a field hex. */
function pressHex(game: Bench, q: number, r: number): void {
  handlePointer(game, { type: "down", x: hexX(q, r), y: hexY(q, r) });
  handlePointer(game, { type: "up", x: hexX(q, r), y: hexY(q, r) });
}

function act(game: Bench, ...actions: ActionName[]): void {
  for (const action of actions) handleAction(game, action);
}

describe("pointing the tape cursor (specs/editor.md)", () => {
  it("points at the row and column a cell press lands in, and sets the focus", () => {
    const game = bench();
    arms(game, 3);
    pressCell(game, 1, 4);
    expect(game.state.editor.cursor).toEqual({
      part: parts(game)[1].id,
      col: 4,
    });
    expect(game.state.editor.focus).toBe("tape");
  });

  it("points at column 0 from a label press", () => {
    const game = bench();
    arms(game, 2);
    pressCell(game, 1, 7);
    pressLabel(game, 1);
    expect(game.state.editor.cursor).toEqual({
      part: parts(game)[1].id,
      col: 0,
    });
  });

  it("leaves the cursor standing on a press that lands on no row or cell", () => {
    const game = bench();
    arms(game, 2);
    pressCell(game, 0, 3);
    const cursor = game.state.editor.cursor;
    handlePointer(game, { type: "down", x: TAPE_COL_X0 - 1, y: TAPE_Y0 + 2 });
    expect(game.state.editor.cursor).toEqual(cursor);
    expect(game.state.editor.focus).toBe("tape");
    handlePointer(game, { type: "up", x: TAPE_COL_X0 - 1, y: TAPE_Y0 + 2 });
    handlePointer(game, {
      type: "down",
      x: TAPE_COL_X0,
      y: TAPE_Y0 + 4 * TAPE_ROW_H,
    });
    expect(game.state.editor.cursor).toEqual(cursor);
  });

  it("gives a row to each arm and wheel alone, in placement order", () => {
    const game = bench();
    arms(game, 1);
    handlePointer(game, { type: "down", x: 12, y: 60 + 3 * 30 });
    handlePointer(game, { type: "move", x: hexX(0, 3), y: hexY(0, 3) });
    handlePointer(game, { type: "up", x: hexX(0, 3), y: hexY(0, 3) });
    expect(parts(game)[1].kind).toBe("bind");
    handlePointer(game, { type: "down", x: 12, y: 60 + 30 });
    handlePointer(game, { type: "move", x: hexX(2, 0), y: hexY(2, 0) });
    handlePointer(game, { type: "up", x: hexX(2, 0), y: hexY(2, 0) });
    expect(parts(game)[2].kind).toBe("wheel");
    pressCell(game, 1, 0);
    expect(game.state.editor.cursor?.part).toBe(parts(game)[2].id);
  });
});

describe("editing at the cursor (specs/editor.md)", () => {
  it("writes each instruction and moves the cursor one cell right", () => {
    const game = bench();
    arms(game, 1);
    pressCell(game, 0, 0);
    act(game, "ins-grab", "ins-rotate-cw", "ins-drop");
    expect(parts(game)[0].tape).toEqual(["grab", "rotate-cw", "drop"]);
    expect(game.state.editor.cursor).toEqual({
      part: parts(game)[0].id,
      col: 3,
    });
  });

  it("overwrites the cell rather than inserting", () => {
    const game = bench();
    arms(game, 1);
    pressCell(game, 0, 0);
    act(game, "ins-grab", "ins-drop");
    pressCell(game, 0, 0);
    act(game, "ins-advance");
    expect(parts(game)[0].tape).toEqual(["advance", "drop"]);
  });

  it("blanks the cell in place, and blanks backwards from the cursor", () => {
    const game = bench();
    arms(game, 1);
    pressCell(game, 0, 0);
    act(game, "ins-grab", "ins-drop", "ins-recede");
    act(game, "ins-blank");
    expect(parts(game)[0].tape).toEqual(["grab", "drop", "recede"]);
    expect(game.state.editor.cursor?.col).toBe(3);
    act(game, "ins-erase");
    expect(parts(game)[0].tape).toEqual(["grab", "drop"]);
    expect(game.state.editor.cursor?.col).toBe(2);
  });

  it("does nothing on ins-erase at column 0", () => {
    const game = bench();
    arms(game, 1);
    pressCell(game, 0, 0);
    act(game, "ins-grab");
    pressCell(game, 0, 0);
    const depth = game.state.editor.undo.length;
    act(game, "ins-erase");
    expect(parts(game)[0].tape).toEqual(["grab"]);
    expect(game.state.editor.cursor?.col).toBe(0);
    expect(game.state.editor.undo).toHaveLength(depth);
  });

  it("lengthens the tape past its end, with blanks between", () => {
    const game = bench();
    arms(game, 1);
    pressCell(game, 0, 0);
    act(game, "ins-grab", "ins-drop");
    pressCell(game, 0, 6);
    act(game, "ins-recede");
    expect(parts(game)[0].tape).toEqual([
      "grab",
      "drop",
      null,
      null,
      null,
      null,
      "recede",
    ]);
  });

  it("moves the cursor between rows, wrapping at both ends", () => {
    const game = bench();
    arms(game, 3);
    pressCell(game, 0, 2);
    act(game, "down");
    expect(game.state.editor.cursor).toEqual({
      part: parts(game)[1].id,
      col: 2,
    });
    act(game, "up", "up");
    expect(game.state.editor.cursor?.part).toBe(parts(game)[2].id);
    act(game, "down");
    expect(game.state.editor.cursor?.part).toBe(parts(game)[0].id);
  });

  it("moves the cursor by one cell, stopping at 0 and never above", () => {
    const game = bench();
    arms(game, 1);
    pressCell(game, 0, 3);
    act(game, "left");
    expect(game.state.editor.cursor?.col).toBe(2);
    act(game, "left", "left", "left");
    expect(game.state.editor.cursor?.col).toBe(0);
    for (let i = 0; i < 60; i += 1) act(game, "right");
    expect(game.state.editor.cursor?.col).toBe(60);
  });

  it("writes the reset expansion and lands the cursor after it", () => {
    const game = bench();
    arms(game, 1);
    pressCell(game, 0, 0);
    act(game, "ins-rotate-cw", "ins-rotate-cw");
    const depth = game.state.editor.undo.length;
    act(game, "ins-reset");
    expect(parts(game)[0].tape).toEqual([
      "rotate-cw",
      "rotate-cw",
      "drop",
      "rotate-ccw",
      "rotate-ccw",
    ]);
    expect(game.state.editor.cursor?.col).toBe(5);
    expect(game.state.editor.undo).toHaveLength(depth + 1);
    act(game, "undo");
    expect(parts(game)[0].tape).toEqual(["rotate-cw", "rotate-cw"]);
  });

  it("writes the repeat copy and lands the cursor at twice the column", () => {
    const game = bench();
    arms(game, 1);
    pressCell(game, 0, 0);
    act(game, "ins-grab", "ins-blank", "right", "ins-drop");
    expect(parts(game)[0].tape).toEqual(["grab", null, "drop"]);
    const depth = game.state.editor.undo.length;
    act(game, "ins-repeat");
    expect(parts(game)[0].tape).toEqual([
      "grab",
      null,
      "drop",
      "grab",
      null,
      "drop",
    ]);
    expect(game.state.editor.cursor?.col).toBe(6);
    expect(game.state.editor.undo).toHaveLength(depth + 1);
  });

  it("writes nothing for a repeat at column 0", () => {
    const game = bench();
    arms(game, 1);
    pressCell(game, 0, 0);
    act(game, "ins-grab");
    pressCell(game, 0, 0);
    const depth = game.state.editor.undo.length;
    act(game, "ins-repeat");
    expect(parts(game)[0].tape).toEqual(["grab"]);
    expect(game.state.editor.cursor?.col).toBe(0);
    expect(game.state.editor.undo).toHaveLength(depth);
  });

  it("pushes no entry for a write that changes nothing", () => {
    const game = bench();
    arms(game, 1);
    pressCell(game, 0, 0);
    act(game, "ins-grab");
    const depth = game.state.editor.undo.length;
    pressCell(game, 0, 0);
    act(game, "ins-grab");
    expect(game.state.editor.undo).toHaveLength(depth);
  });
});

describe("the focus routes the shared keys (specs/controls.md)", () => {
  it("routes KeyW and KeyS to the arm under field focus", () => {
    const game = bench();
    arms(game, 1);
    pressHex(game, -2, 0);
    expect(game.state.editor.focus).toBe("field");
    act(game, "part-grow", "ins-extend");
    expect(parts(game)[0].length).toBe(2);
    expect(parts(game)[0].tape).toEqual([]);
    act(game, "part-shrink", "ins-retract");
    expect(parts(game)[0].length).toBe(1);
    expect(parts(game)[0].tape).toEqual([]);
  });

  it("routes KeyW and KeyS to the tape under tape focus", () => {
    const game = bench();
    arms(game, 1);
    pressHex(game, -2, 0);
    pressCell(game, 0, 0);
    act(game, "part-grow", "ins-extend");
    expect(parts(game)[0].length).toBe(1);
    expect(parts(game)[0].tape).toEqual(["extend"]);
    act(game, "part-shrink", "ins-retract");
    expect(parts(game)[0].tape).toEqual(["extend", "retract"]);
  });

  it("rests the focus on the field when a challenge opens", () => {
    const game = bench();
    arms(game, 1);
    pressCell(game, 0, 0);
    expect(game.state.editor.focus).toBe("tape");
    openChallenge(game, "extras", 0);
    expect(game.state.editor.focus).toBe("field");
  });
});

describe("undo and redo (specs/editor.md)", () => {
  it("pushes one entry per committed edit and undoes them one at a time", () => {
    const game = bench();
    arms(game, 1);
    pressCell(game, 0, 0);
    act(game, "ins-grab", "ins-drop", "ins-recede");
    expect(game.state.editor.undo).toHaveLength(4);
    act(game, "undo", "undo", "undo");
    expect(parts(game)[0].tape).toEqual([]);
    expect(game.state.editor.redo).toHaveLength(3);
    act(game, "redo");
    expect(parts(game)[0].tape).toEqual(["grab"]);
  });

  it("clears the redo side on a new committed edit", () => {
    const game = bench();
    arms(game, 1);
    pressCell(game, 0, 0);
    act(game, "ins-grab", "ins-drop");
    act(game, "undo");
    expect(game.state.editor.redo).toHaveLength(1);
    act(game, "ins-advance");
    expect(game.state.editor.redo).toHaveLength(0);
  });

  it("leaves selection, cursor, and focus out of the history", () => {
    const game = bench();
    arms(game, 1);
    pressCell(game, 0, 0);
    act(game, "ins-grab");
    const cursor = game.state.editor.cursor;
    const focus = game.state.editor.focus;
    act(game, "undo");
    expect(game.state.editor.cursor).toEqual(cursor);
    expect(game.state.editor.focus).toBe(focus);
  });

  it("clears a selection and a cursor an undo or a redo removes", () => {
    const game = bench();
    arms(game, 1);
    const arm = parts(game)[0].id;
    pressHex(game, -2, 0);
    expect(game.state.editor.selected).toBe(arm);
    act(game, "undo");
    expect(parts(game)).toEqual([]);
    expect(game.state.editor.selected).toBeNull();
    expect(game.state.editor.cursor).toBeNull();
    act(game, "redo");
    expect(parts(game)).toHaveLength(1);
    expect(game.state.editor.selected).toBeNull();
  });

  it("reaches back forty edits to the machine the visit began with", () => {
    const game = bench();
    arms(game, 1);
    pressCell(game, 0, 0);
    for (let i = 0; i < 39; i += 1) act(game, "ins-grab");
    expect(game.state.editor.undo).toHaveLength(40);
    for (let i = 0; i < 40; i += 1) act(game, "undo");
    expect(parts(game)).toEqual([]);
  });

  it("is inert during a run, either way", () => {
    const game = bench();
    arms(game, 1);
    startRun(game);
    act(game, "undo");
    expect(parts(game)).toHaveLength(1);
    expect(game.state.editor.undo).toHaveLength(1);
  });

  it("keeps the machine across a visit but not the histories", () => {
    const game = new Bench();
    enterFromSelect(game, "extras", 0);
    handlePointer(game, { type: "down", x: 12, y: 60 });
    handlePointer(game, { type: "move", x: hexX(0, 0), y: hexY(0, 0) });
    handlePointer(game, { type: "up", x: hexX(0, 0), y: hexY(0, 0) });
    expect(game.state.editor.undo).toHaveLength(1);
    enterScreen(game, "select");
    enterFromSelect(game, "extras", 0);
    expect(parts(game)).toHaveLength(1);
    expect(game.state.editor.undo).toHaveLength(0);
    expect(game.state.editor.redo).toHaveLength(0);
  });
});
