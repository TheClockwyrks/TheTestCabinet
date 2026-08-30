// The geometry of the table, as specs/table.md fixes it.

import { beforeEach, describe, expect, it } from "vitest";
import type { Card } from "./cards";
import {
  CARD_H,
  CARD_W,
  COLUMN_BOTTOM_LIMIT,
  COLUMN_X,
  FACE_DOWN_OFFSET,
  FACE_UP_OFFSET,
  FACE_UP_OFFSET_MIN,
  FOUNDATION_X,
  STOCK_X,
  TABLEAU_Y,
  TOP_ROW_Y,
  WASTE_FAN,
  WASTE_X,
  type Suit,
} from "./constants";
import {
  anchorOf,
  cardAtPoint,
  columnBottom,
  columnCardTops,
  columnFaceUpOffset,
  contains,
  dropRect,
  pileAtPoint,
  wasteFanX,
} from "./layout";
import { createState, type CascadeState } from "./state";

let state: CascadeState;
let nextId = 0;

function card(suit: Suit, rank: number, faceUp = true): Card {
  nextId += 1;
  return { id: nextId, suit, rank, faceUp };
}

beforeEach(() => {
  state = createState(() => null);
});

describe("the anchors", () => {
  it("spaces the seven columns at a pitch of 122", () => {
    for (let i = 1; i < COLUMN_X.length; i += 1) {
      expect(COLUMN_X[i] - COLUMN_X[i - 1]).toBe(122);
    }
  });

  it("puts the top row on the column positions it uses", () => {
    expect(anchorOf("stock", 0)).toEqual({ x: STOCK_X, y: TOP_ROW_Y });
    expect(anchorOf("waste", 0)).toEqual({ x: WASTE_X, y: TOP_ROW_Y });
    expect(anchorOf("foundation", 2)).toEqual({
      x: FOUNDATION_X[2],
      y: TOP_ROW_Y,
    });
    expect(anchorOf("tableau", 4)).toEqual({ x: COLUMN_X[4], y: TABLEAU_Y });
    expect(STOCK_X).toBe(COLUMN_X[0]);
    expect(WASTE_X).toBe(COLUMN_X[1]);
    expect(FOUNDATION_X).toEqual([
      COLUMN_X[3],
      COLUMN_X[4],
      COLUMN_X[5],
      COLUMN_X[6],
    ]);
  });

  it("fans the waste to the right at its pitch and stops short of a foundation", () => {
    expect(wasteFanX(0)).toBe(WASTE_X);
    expect(wasteFanX(2)).toBe(WASTE_X + 2 * WASTE_FAN);
    expect(wasteFanX(2) + CARD_W).toBeLessThan(FOUNDATION_X[0]);
  });
});

describe("a column's offsets", () => {
  it("uses the natural offsets when the column fits", () => {
    const column = [
      card("spades", 1, false),
      card("hearts", 2),
      card("clubs", 3),
    ];
    expect(columnFaceUpOffset(column)).toBe(FACE_UP_OFFSET);
    expect(columnCardTops(column)).toEqual([
      TABLEAU_Y,
      TABLEAU_Y + FACE_DOWN_OFFSET,
      TABLEAU_Y + FACE_DOWN_OFFSET + FACE_UP_OFFSET,
    ]);
  });

  it("compresses a long column to fit above the bottom limit", () => {
    const column = [
      card("spades", 1, false),
      ...Array.from({ length: 13 }, (_, i) => card("hearts", i + 1)),
    ];
    const offset = columnFaceUpOffset(column);
    expect(offset).toBeLessThan(FACE_UP_OFFSET);
    expect(offset).toBeGreaterThanOrEqual(FACE_UP_OFFSET_MIN);
    expect(columnBottom(column)).toBeCloseTo(COLUMN_BOTTOM_LIMIT, 6);
  });

  it("never compresses below the floor, however long the column", () => {
    const column = Array.from({ length: 40 }, (_, i) =>
      card("hearts", (i % 13) + 1),
    );
    expect(columnFaceUpOffset(column)).toBe(FACE_UP_OFFSET_MIN);
  });

  it("leaves the face-down offset alone under compression", () => {
    const column = [
      ...Array.from({ length: 4 }, () => card("spades", 1, false)),
      ...Array.from({ length: 12 }, (_, i) => card("hearts", i + 1)),
    ];
    const tops = columnCardTops(column);
    expect(tops[1] - tops[0]).toBe(FACE_DOWN_OFFSET);
    expect(tops[4] - tops[3]).toBe(FACE_DOWN_OFFSET);
  });

  it("draws the full offset again once a compressed column loses cards", () => {
    const long = Array.from({ length: 14 }, (_, i) =>
      card("hearts", (i % 13) + 1),
    );
    expect(columnFaceUpOffset(long)).toBeLessThan(FACE_UP_OFFSET);
    expect(columnFaceUpOffset(long.slice(0, 3))).toBe(FACE_UP_OFFSET);
  });
});

describe("the drop rectangles", () => {
  it("gives the top row one card footprint each", () => {
    expect(dropRect(state, "stock", 0)).toEqual({
      x: STOCK_X,
      y: TOP_ROW_Y,
      w: CARD_W,
      h: CARD_H,
    });
    expect(dropRect(state, "waste", 0)).toEqual({
      x: WASTE_X,
      y: TOP_ROW_Y,
      w: CARD_W,
      h: CARD_H,
    });
    expect(dropRect(state, "foundation", 1)).toEqual({
      x: FOUNDATION_X[1],
      y: TOP_ROW_Y,
      w: CARD_W,
      h: CARD_H,
    });
  });

  it("gives an empty column a card footprint at its anchor", () => {
    expect(dropRect(state, "tableau", 3)).toEqual({
      x: COLUMN_X[3],
      y: TABLEAU_Y,
      w: CARD_W,
      h: CARD_H,
    });
  });

  it("runs a column's rectangle to the bottom edge of its lowest card", () => {
    state.tableau[0] = [card("spades", 5), card("hearts", 4)];
    const rect = dropRect(state, "tableau", 0);
    expect(rect.h).toBe(columnBottom(state.tableau[0]) - TABLEAU_Y);
    expect(rect.h).toBe(FACE_UP_OFFSET + CARD_H);
  });

  it("leaves no point in two rectangles at once", () => {
    state.tableau = state.tableau.map(() => [card("spades", 13)]);
    for (let x = 0; x < 1280; x += 7) {
      for (let y = 0; y < 720; y += 7) {
        const hits = [
          dropRect(state, "stock", 0),
          dropRect(state, "waste", 0),
          ...[0, 1, 2, 3].map((i) => dropRect(state, "foundation", i)),
          ...[0, 1, 2, 3, 4, 5, 6].map((i) => dropRect(state, "tableau", i)),
        ].filter((rect) => contains(rect, x, y));
        expect(hits.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it("resolves a point to the one pile whose rectangle holds it", () => {
    expect(pileAtPoint(state, FOUNDATION_X[2] + 10, TOP_ROW_Y + 10)).toEqual({
      kind: "foundation",
      index: 2,
    });
    // The gap between two columns carries no pile.
    expect(
      pileAtPoint(state, COLUMN_X[0] + CARD_W + 5, TABLEAU_Y + 10),
    ).toBeNull();
    // Nor does the third column position in the top row.
    expect(pileAtPoint(state, COLUMN_X[2] + 10, TOP_ROW_Y + 10)).toBeNull();
  });
});

describe("cardAtPoint", () => {
  it("finds a column's lowest card where two overlap", () => {
    state.tableau[0] = [card("spades", 5), card("hearts", 4)];
    const tops = columnCardTops(state.tableau[0]);
    const overlap = tops[1] + 4;
    expect(cardAtPoint(state, COLUMN_X[0] + 20, overlap)).toEqual({
      kind: "tableau",
      index: 0,
      row: 1,
    });
    expect(cardAtPoint(state, COLUMN_X[0] + 20, tops[0] + 4)).toEqual({
      kind: "tableau",
      index: 0,
      row: 0,
    });
  });

  it("finds a fanned waste card over the squared pile beneath it", () => {
    for (let i = 0; i < 6; i += 1) state.waste.push(card("spades", i + 1));
    state.wasteSets = [3, 3];
    expect(cardAtPoint(state, wasteFanX(2) + 50, TOP_ROW_Y + 10)).toEqual({
      kind: "waste",
      index: 0,
      row: 5,
    });
    // At the anchor the frontmost card drawn is the first of the fan, not the top.
    expect(cardAtPoint(state, WASTE_X + 4, TOP_ROW_Y + 10)).toEqual({
      kind: "waste",
      index: 0,
      row: 3,
    });
  });

  it("finds nothing on the bare table", () => {
    expect(cardAtPoint(state, 20, 400)).toBeNull();
  });
});
