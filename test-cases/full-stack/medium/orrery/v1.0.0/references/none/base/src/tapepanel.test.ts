import { describe, expect, it } from "vitest";

import {
  STAGE_H,
  TAPE_CELL_W,
  TAPE_COLS_VISIBLE,
  TAPE_ROWS_VISIBLE,
  TAPE_ROW_H,
  TAPE_Y0,
  TRAY_REGION_W,
} from "./constants";
import { createPart } from "./machine";
import {
  TAPE_COL_X0,
  TAPE_LABEL_X1,
  tapeCellRect,
  tapeFirstCol,
  tapeFirstRow,
  tapeHitAt,
  tapeLabelRect,
  tapeRowRect,
  visibleColAt,
  visibleRowAt,
} from "./tapepanel";
import type { PartState } from "./types";

/** `count` arms in placement order, with a sigil between two of them. */
function machine(count: number): PartState[] {
  const parts: PartState[] = [];
  for (let i = 0; i < count; i += 1) {
    parts.push(createPart(i + 1, "arm", i, 0, 0));
  }
  parts.push(createPart(count + 1, "bind", 0, 3, 0));
  return parts;
}

describe("the tape panel's scroll positions (specs/editor.md)", () => {
  it("rests firstRow at 0 until the cursor passes the fifth row", () => {
    const parts = machine(10);
    expect(tapeFirstRow(parts, { part: parts[3].id, col: 0 })).toBe(0);
    expect(
      tapeFirstRow(parts, { part: parts[TAPE_ROWS_VISIBLE - 1].id, col: 0 }),
    ).toBe(0);
  });

  it("scrolls rows to keep the cursor's row the bottom visible one", () => {
    const parts = machine(10);
    expect(tapeFirstRow(parts, { part: parts[7].id, col: 0 })).toBe(3);
    expect(tapeFirstRow(parts, { part: parts[9].id, col: 0 })).toBe(5);
  });

  it("rests firstRow at 0 with no cursor", () => {
    expect(tapeFirstRow(machine(10), null)).toBe(0);
  });

  it("rests firstCol at 0 below forty columns, and scrolls past it", () => {
    expect(tapeFirstCol({ part: 1, col: 10 })).toBe(0);
    expect(tapeFirstCol({ part: 1, col: TAPE_COLS_VISIBLE - 1 })).toBe(0);
    expect(tapeFirstCol({ part: 1, col: 50 })).toBe(11);
    expect(tapeFirstCol(null)).toBe(0);
  });
});

describe("the tape panel's rectangles (specs/editor.md)", () => {
  it("spans a label from the panel's left edge across its row", () => {
    expect(tapeLabelRect(0)).toEqual({
      x0: TRAY_REGION_W,
      y0: TAPE_Y0,
      x1: TAPE_LABEL_X1,
      y1: TAPE_Y0 + TAPE_ROW_H,
    });
    expect(TAPE_LABEL_X1).toBe(304);
    expect(TAPE_COL_X0).toBe(312);
  });

  it("begins the columns at the fixed offset, each TAPE_CELL_W wide", () => {
    expect(tapeCellRect(0, 0).x0).toBe(312);
    expect(tapeCellRect(0, 1).x0).toBe(312 + TAPE_CELL_W);
    expect(tapeRowRect(2).y0).toBe(TAPE_Y0 + 2 * TAPE_ROW_H);
  });

  it("shows five rows and forty columns and no more", () => {
    expect(visibleRowAt(TAPE_Y0)).toBe(0);
    expect(visibleRowAt(TAPE_Y0 + 4 * TAPE_ROW_H)).toBe(4);
    expect(visibleRowAt(TAPE_Y0 + 5 * TAPE_ROW_H)).toBeNull();
    expect(visibleRowAt(STAGE_H)).toBeNull();
    expect(visibleColAt(TAPE_COL_X0)).toBe(0);
    expect(visibleColAt(TAPE_COL_X0 + 39 * TAPE_CELL_W)).toBe(39);
    expect(visibleColAt(TAPE_COL_X0 + 40 * TAPE_CELL_W)).toBeNull();
    expect(visibleColAt(TAPE_COL_X0 - 1)).toBeNull();
  });
});

describe("pointing the cursor from a press (specs/editor.md)", () => {
  it("points at that row and column from a cell press", () => {
    const parts = machine(3);
    const hit = tapeHitAt(
      parts,
      null,
      TAPE_COL_X0 + 2 * TAPE_CELL_W,
      TAPE_Y0 + TAPE_ROW_H,
    );
    expect(hit).toEqual({ part: parts[1].id, col: 2 });
  });

  it("points at column 0 from a label press", () => {
    const parts = machine(3);
    expect(
      tapeHitAt(parts, { part: parts[0].id, col: 9 }, TRAY_REGION_W, TAPE_Y0),
    ).toEqual({ part: parts[0].id, col: 0 });
  });

  it("lands on nothing between the label and the first column", () => {
    const parts = machine(3);
    expect(tapeHitAt(parts, null, TAPE_COL_X0 - 1, TAPE_Y0)).toBeNull();
  });

  it("lands on nothing below the last row", () => {
    const parts = machine(3);
    expect(
      tapeHitAt(parts, null, TAPE_COL_X0, TAPE_Y0 + 3 * TAPE_ROW_H),
    ).toBeNull();
    expect(
      tapeHitAt(parts, null, TAPE_COL_X0, TAPE_Y0 + 5 * TAPE_ROW_H),
    ).toBeNull();
  });

  it("reads the visible row and column through the derived scroll", () => {
    const parts = machine(10);
    const cursor = { part: parts[7].id, col: 50 };
    // firstRow 3, firstCol 11.
    expect(tapeHitAt(parts, cursor, TAPE_COL_X0, TAPE_Y0)).toEqual({
      part: parts[3].id,
      col: 11,
    });
  });
});
