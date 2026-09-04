// Wireworm — the node field and its starting scatter (specs/nodes.md).

import { describe, expect, test } from "vitest";
import {
  COLS,
  ROWS,
  SCATTER_BOTTOM_ROW,
  SCATTER_MAX_FRACTION,
  SCATTER_MIN_FRACTION,
  SCATTER_TOP_ROW,
} from "./constants";
import {
  EMPTY,
  chargeAt,
  clearNodes,
  countNodes,
  emptyField,
  hasNode,
  listNodes,
  removeNode,
  scatterField,
  setCharge,
} from "./field";

/** The tiles the scatter may use. */
const SCATTER_TILES = (SCATTER_BOTTOM_ROW - SCATTER_TOP_ROW + 1) * COLS;

function scattered(seed: number): Int8Array {
  const field = emptyField();
  scatterField(field, { rngState: seed });
  return field;
}

describe("the field", () => {
  test("a fresh board holds no node", () => {
    const field = emptyField();
    expect(listNodes(field)).toEqual([]);
    expect(chargeAt(field, 5, 5)).toBe(EMPTY);
    expect(hasNode(field, 5, 5)).toBe(false);
  });

  test("a charge is set, read back, and removed", () => {
    const field = emptyField();
    setCharge(field, 3, 4, 2);
    expect(chargeAt(field, 3, 4)).toBe(2);
    expect(hasNode(field, 3, 4)).toBe(true);
    removeNode(field, 3, 4);
    expect(hasNode(field, 3, 4)).toBe(false);
  });

  test("a charge is held inside its range and rounded to a whole number", () => {
    const field = emptyField();
    setCharge(field, 1, 1, 9);
    expect(chargeAt(field, 1, 1)).toBe(3);
    setCharge(field, 1, 1, -4);
    expect(chargeAt(field, 1, 1)).toBe(0);
    setCharge(field, 1, 1, 1.6);
    expect(chargeAt(field, 1, 1)).toBe(2);
  });

  test("an off-board tile is neither set nor read", () => {
    const field = emptyField();
    setCharge(field, -1, 4, 2);
    setCharge(field, COLS, 4, 2);
    setCharge(field, 4, ROWS, 2);
    removeNode(field, -1, -1);
    expect(listNodes(field)).toEqual([]);
    expect(chargeAt(field, -1, 4)).toBe(EMPTY);
  });

  test("nodes are listed ascending by row and then by column", () => {
    const field = emptyField();
    setCharge(field, 9, 4, 1);
    setCharge(field, 2, 4, 2);
    setCharge(field, 5, 1, 3);
    expect(listNodes(field)).toEqual([
      { c: 5, r: 1, charge: 3 },
      { c: 2, r: 4, charge: 2 },
      { c: 9, r: 4, charge: 1 },
    ]);
  });

  test("clearing empties the whole board", () => {
    const field = scattered(4);
    expect(listNodes(field).length).toBeGreaterThan(0);
    clearNodes(field);
    expect(listNodes(field)).toEqual([]);
  });

  test("a count covers exactly the rows it was given", () => {
    const field = emptyField();
    setCharge(field, 0, 9, 0);
    setCharge(field, 1, 10, 0);
    setCharge(field, 2, 19, 0);
    expect(countNodes(field, 10, 19)).toBe(2);
    expect(countNodes(field, 0, 19)).toBe(3);
    // Rows outside the board are simply not counted.
    expect(countNodes(field, -5, 40)).toBe(3);
  });
});

describe("the starting scatter", () => {
  test("it lays between a tenth and a seventh of the scatter rows", () => {
    for (const seed of [1, 2, 3, 7, 8, 99]) {
      const laid = listNodes(scattered(seed)).length;
      expect(laid).toBeGreaterThanOrEqual(
        Math.floor(SCATTER_TILES * SCATTER_MIN_FRACTION),
      );
      expect(laid).toBeLessThanOrEqual(
        Math.ceil(SCATTER_TILES * SCATTER_MAX_FRACTION),
      );
    }
  });

  test("it keeps out of the entry row and the player band", () => {
    for (const seed of [1, 5, 12]) {
      for (const node of listNodes(scattered(seed))) {
        expect(node.r).toBeGreaterThanOrEqual(SCATTER_TOP_ROW);
        expect(node.r).toBeLessThanOrEqual(SCATTER_BOTTOM_ROW);
      }
    }
  });

  test("every node it lays is inert", () => {
    for (const node of listNodes(scattered(3))) expect(node.charge).toBe(0);
  });

  test("one seed lays one field and two seeds lay two", () => {
    const first = listNodes(scattered(7));
    const again = listNodes(scattered(7));
    expect(again).toEqual(first);

    const other = listNodes(scattered(8));
    const shared = other.filter((node) =>
      first.some((seen) => seen.c === node.c && seen.r === node.r),
    ).length;
    // More than a tenth of the occupied tiles differ.
    expect(shared).toBeLessThan(first.length * 0.9);
  });
});
