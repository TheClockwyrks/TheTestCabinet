import { describe, expect, it } from "vitest";
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
  WASTE_X,
} from "./constants";
import {
  columnCardYs,
  columnDropRect,
  dropZones,
  faceUpOffset,
  foundationRect,
  stockRect,
  wasteRect,
  zoneAt,
} from "./table";
import type { Card } from "./types";

let next = 0;
function card(faceUp: boolean): Card {
  next += 1;
  return { id: next, suit: "spades", rank: 1, faceUp };
}

function column(faces: readonly boolean[]): Card[] {
  return faces.map(card);
}

describe("the top row", () => {
  it("anchors the stock, the waste and the four foundations", () => {
    expect(stockRect()).toEqual({
      x: STOCK_X,
      y: TOP_ROW_Y,
      w: CARD_W,
      h: CARD_H,
    });
    expect(wasteRect()).toEqual({
      x: WASTE_X,
      y: TOP_ROW_Y,
      w: CARD_W,
      h: CARD_H,
    });
    for (let i = 0; i < FOUNDATION_X.length; i += 1) {
      expect(foundationRect(i).x).toBe(FOUNDATION_X[i]);
      expect(foundationRect(i).y).toBe(TOP_ROW_Y);
    }
  });
});

describe("a column's fan", () => {
  it("starts at the tableau anchor", () => {
    expect(columnCardYs(column([true]))[0]).toBe(TABLEAU_Y);
  });

  it("offsets 24 under a face-down card and 34 under a face-up one", () => {
    const ys = columnCardYs(column([false, true, true]));
    expect(ys[1] - ys[0]).toBe(FACE_DOWN_OFFSET);
    expect(ys[2] - ys[1]).toBe(FACE_UP_OFFSET);
  });

  it("compresses a long column to the limit", () => {
    const long = column(Array.from({ length: 19 }, () => true));
    const ys = columnCardYs(long);
    expect(ys[ys.length - 1] + CARD_H).toBeLessThanOrEqual(COLUMN_BOTTOM_LIMIT);
  });

  it("compresses uniformly and never past the floor", () => {
    const long = column(Array.from({ length: 40 }, () => true));
    const ys = columnCardYs(long);
    const gaps = ys.slice(1).map((y, i) => y - ys[i]);
    expect(new Set(gaps).size).toBe(1);
    expect(gaps[0]).toBe(FACE_UP_OFFSET_MIN);
  });

  it("leaves the face-down offset alone while it compresses", () => {
    const mixed = column([
      false,
      false,
      false,
      ...Array.from({ length: 14 }, () => true),
    ]);
    const ys = columnCardYs(mixed);
    expect(ys[1] - ys[0]).toBe(FACE_DOWN_OFFSET);
    expect(ys[2] - ys[1]).toBe(FACE_DOWN_OFFSET);
    expect(ys[4] - ys[3]).toBeLessThan(FACE_UP_OFFSET);
  });

  it("relaxes back to 34 once the column is short again", () => {
    const long = column(Array.from({ length: 19 }, () => true));
    expect(faceUpOffset(long)).toBeLessThan(FACE_UP_OFFSET);
    expect(faceUpOffset(long.slice(0, 4))).toBe(FACE_UP_OFFSET);
  });
});

describe("the drop rectangles", () => {
  it("gives an empty column the card footprint at its anchor", () => {
    expect(columnDropRect(2, [])).toEqual({
      x: COLUMN_X[2],
      y: TABLEAU_Y,
      w: CARD_W,
      h: CARD_H,
    });
  });

  it("runs a filled column from the anchor to its lowest card's bottom", () => {
    const cards = column([false, true, true]);
    const ys = columnCardYs(cards);
    const rect = columnDropRect(0, cards);
    expect(rect.y).toBe(TABLEAU_Y);
    expect(rect.h).toBe(ys[ys.length - 1] + CARD_H - TABLEAU_Y);
  });

  it("holds thirteen rectangles that never overlap", () => {
    const foundations = [[], [], [], []];
    const tableau = Array.from({ length: 7 }, () => column([true, true]));
    const zones = dropZones(foundations, tableau);
    expect(zones).toHaveLength(13);
    for (let a = 0; a < zones.length; a += 1) {
      for (let b = a + 1; b < zones.length; b += 1) {
        const one = zones[a].rect;
        const other = zones[b].rect;
        const overlap =
          Math.max(
            0,
            Math.min(one.x + one.w, other.x + other.w) -
              Math.max(one.x, other.x),
          ) *
          Math.max(
            0,
            Math.min(one.y + one.h, other.y + other.h) -
              Math.max(one.y, other.y),
          );
        expect(overlap).toBe(0);
      }
    }
  });

  it("resolves a point to the one pile that holds it, and to none elsewhere", () => {
    const foundations = [[], [], [], []];
    const tableau = Array.from({ length: 7 }, () => [] as Card[]);
    expect(zoneAt(STOCK_X + 5, TOP_ROW_Y + 5, foundations, tableau)).toEqual({
      pile: "stock",
      index: 0,
      rect: stockRect(),
    });
    expect(
      zoneAt(FOUNDATION_X[2] + 1, TOP_ROW_Y + 1, foundations, tableau)?.index,
    ).toBe(2);
    expect(
      zoneAt(COLUMN_X[4] + 1, TABLEAU_Y + 1, foundations, tableau)?.pile,
    ).toBe("tableau");
    // The gap between two columns, the empty third slot of the top row, and
    // the HUD strip all belong to no pile.
    expect(
      zoneAt(COLUMN_X[0] + CARD_W + 5, TABLEAU_Y + 5, foundations, tableau),
    ).toBeNull();
    expect(zoneAt(468 + 10, TOP_ROW_Y + 10, foundations, tableau)).toBeNull();
    expect(zoneAt(600, 700, foundations, tableau)).toBeNull();
  });
});
