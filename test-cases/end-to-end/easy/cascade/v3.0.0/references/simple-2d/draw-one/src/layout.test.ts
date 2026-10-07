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
import { makeCard } from "./deck";
import { openingState } from "./flow";
import {
  cardAtPoint,
  cardCenter,
  cardTopLeft,
  columnBottom,
  columnCardTops,
  controlAtPoint,
  dropRect,
  faceUpGap,
  pileAnchor,
  pileAtPoint,
  pointIn,
} from "./layout";
import { withPile } from "./piles";
import type { CardState, CascadeState } from "./game";

let nextId = 1;
const card = (faceUp: boolean): CardState =>
  makeCard(nextId++, "spades", 7, faceUp);

function column(faces: readonly boolean[]): readonly CardState[] {
  return faces.map(card);
}

function posedColumn(index: number, faces: readonly boolean[]): CascadeState {
  return withPile(openingState(), "tableau", index, column(faces));
}

describe("the anchors", () => {
  it("puts every pile where specs/table.md says", () => {
    expect(pileAnchor("stock", 0)).toEqual({ x: STOCK_X, y: TOP_ROW_Y });
    expect(pileAnchor("waste", 0)).toEqual({ x: WASTE_X, y: TOP_ROW_Y });
    expect(pileAnchor("foundation", 2)).toEqual({
      x: FOUNDATION_X[2],
      y: TOP_ROW_Y,
    });
    expect(pileAnchor("tableau", 4)).toEqual({
      x: COLUMN_X[4],
      y: TABLEAU_Y,
    });
  });

  it("centers a card on its footprint", () => {
    expect(cardCenter(100, 200)).toEqual({
      x: 100 + CARD_W / 2,
      y: 200 + CARD_H / 2,
    });
  });
});

describe("a column's fan", () => {
  it("offsets by 24 under a face-down card and 34 under a face-up one", () => {
    const tops = columnCardTops(column([false, true, true]));
    expect(tops[0]).toBe(TABLEAU_Y);
    expect(tops[1] - tops[0]).toBe(FACE_DOWN_OFFSET);
    expect(tops[2] - tops[1]).toBe(FACE_UP_OFFSET);
  });

  it("keeps the full offset while the column fits", () => {
    expect(faceUpGap(column([true, true, true]))).toBe(FACE_UP_OFFSET);
  });

  it("compresses a long column to the line and no further", () => {
    const cards = column(Array.from({ length: 19 }, () => true));
    const gap = faceUpGap(cards);
    expect(gap).toBeLessThan(FACE_UP_OFFSET);
    expect(gap).toBeGreaterThanOrEqual(FACE_UP_OFFSET_MIN);
    expect(columnBottom(cards)).toBeCloseTo(COLUMN_BOTTOM_LIMIT, 6);
  });

  it("never falls below the floor offset", () => {
    const cards = column(Array.from({ length: 40 }, () => true));
    expect(faceUpGap(cards)).toBe(FACE_UP_OFFSET_MIN);
  });

  it("leaves the face-down offset alone when compressed", () => {
    const faces = [
      ...Array.from({ length: 3 }, () => false),
      ...Array.from({ length: 16 }, () => true),
    ];
    const cards = column(faces);
    const tops = columnCardTops(cards);
    expect(tops[1] - tops[0]).toBe(FACE_DOWN_OFFSET);
    expect(tops[2] - tops[1]).toBe(FACE_DOWN_OFFSET);
    expect(tops[5] - tops[4]).toBeLessThan(FACE_UP_OFFSET);
  });

  it("relaxes again once a column has lost cards", () => {
    const long = column(Array.from({ length: 19 }, () => true));
    expect(faceUpGap(long)).toBeLessThan(FACE_UP_OFFSET);
    expect(faceUpGap(long.slice(0, 5))).toBe(FACE_UP_OFFSET);
  });
});

describe("the drop rectangles", () => {
  it("gives every squared pile a card footprint at its anchor", () => {
    const state = openingState();
    expect(dropRect(state, "stock", 0)).toEqual({
      x: STOCK_X,
      y: TOP_ROW_Y,
      w: CARD_W,
      h: CARD_H,
    });
    expect(dropRect(state, "waste", 0).w).toBe(CARD_W);
    expect(dropRect(state, "foundation", 1)).toEqual({
      x: FOUNDATION_X[1],
      y: TOP_ROW_Y,
      w: CARD_W,
      h: CARD_H,
    });
  });

  it("gives an empty column a card footprint and a full one its extent", () => {
    expect(dropRect(openingState(), "tableau", 0)).toEqual({
      x: COLUMN_X[0],
      y: TABLEAU_Y,
      w: CARD_W,
      h: CARD_H,
    });
    const state = posedColumn(0, [true, true, true]);
    const rect = dropRect(state, "tableau", 0);
    expect(rect.h).toBe(2 * FACE_UP_OFFSET + CARD_H);
  });

  it("never overlaps, so a point lies in at most one", () => {
    const state = posedColumn(
      0,
      Array.from({ length: 8 }, () => true),
    );
    for (const point of [
      { x: STOCK_X + 5, y: TOP_ROW_Y + 5 },
      { x: COLUMN_X[0] + 5, y: 400 },
    ]) {
      let hits = 0;
      for (const pile of ["stock", "waste"] as const) {
        if (pointIn(dropRect(state, pile, 0), point.x, point.y)) hits++;
      }
      for (let i = 0; i < 4; i++) {
        if (pointIn(dropRect(state, "foundation", i), point.x, point.y)) hits++;
      }
      for (let i = 0; i < 7; i++) {
        if (pointIn(dropRect(state, "tableau", i), point.x, point.y)) hits++;
      }
      expect(hits).toBe(1);
    }
  });

  it("answers no pile between the columns or at the gap in the top row", () => {
    const state = openingState();
    expect(pileAtPoint(state, 468, TOP_ROW_Y + 10)).toBeNull();
    expect(pileAtPoint(state, COLUMN_X[0] + CARD_W + 10, 300)).toBeNull();
    expect(pileAtPoint(state, STOCK_X + 10, TOP_ROW_Y + 10)).toEqual({
      pile: "stock",
      index: 0,
    });
  });
});

describe("the card under a point", () => {
  it("is a column's lowest card whose footprint holds it", () => {
    const state = posedColumn(2, [false, true, true]);
    const tops = columnCardTops(state.tableau[2]);
    expect(cardAtPoint(state, COLUMN_X[2] + 50, tops[2] + 100)).toEqual({
      pile: "tableau",
      index: 2,
      row: 2,
    });
    expect(cardAtPoint(state, COLUMN_X[2] + 50, tops[0] + 5)).toEqual({
      pile: "tableau",
      index: 2,
      row: 0,
    });
    expect(
      cardAtPoint(state, COLUMN_X[2] + 50, tops[2] + CARD_H + 5),
    ).toBeNull();
  });

  it("is the waste's top card only while the waste shows one", () => {
    const cards = [makeCard(80, "hearts", 4, true)];
    const bare = withPile(openingState(), "waste", 0, cards);
    expect(cardAtPoint(bare, WASTE_X + 10, TOP_ROW_Y + 10)).toBeNull();
    const shown = { ...bare, wasteSets: [1] };
    expect(cardAtPoint(shown, WASTE_X + 10, TOP_ROW_Y + 10)).toEqual({
      pile: "waste",
      index: 0,
      row: 0,
    });
  });

  it("is a foundation's top card, and never the stock's", () => {
    const state = withPile(
      withPile(openingState(), "foundation", 0, [
        makeCard(90, "spades", 1, true),
      ]),
      "stock",
      0,
      [makeCard(91, "clubs", 9, false)],
    );
    expect(cardAtPoint(state, FOUNDATION_X[0] + 10, TOP_ROW_Y + 10)).toEqual({
      pile: "foundation",
      index: 0,
      row: 0,
    });
    expect(cardAtPoint(state, STOCK_X + 10, TOP_ROW_Y + 10)).toBeNull();
  });

  it("reads a card's drawn position from its pile and row", () => {
    const state = posedColumn(1, [false, true]);
    expect(cardTopLeft(state, "tableau", 1, 1)).toEqual({
      x: COLUMN_X[1],
      y: TABLEAU_Y + FACE_DOWN_OFFSET,
    });
    expect(cardTopLeft(state, "waste", 0, 0)).toEqual({
      x: WASTE_X,
      y: TOP_ROW_Y,
    });
  });
});

describe("the controls", () => {
  it("answers only on the screen it belongs to", () => {
    expect(controlAtPoint("title", 640, 474)).toBe("title-new-game");
    expect(controlAtPoint("title", 640, 542)).toBe("title-how-to");
    expect(controlAtPoint("playing", 640, 474)).toBeNull();
    expect(controlAtPoint("howto", 640, 626)).toBe("howto-back");
    expect(controlAtPoint("playing", 300, 698)).toBe("hud-new-game");
    expect(controlAtPoint("playing", 480, 698)).toBe("hud-menu");
    expect(controlAtPoint("playing", 616, 698)).toBe("hud-sound");
    expect(controlAtPoint("won", 616, 698)).toBeNull();
  });
});
