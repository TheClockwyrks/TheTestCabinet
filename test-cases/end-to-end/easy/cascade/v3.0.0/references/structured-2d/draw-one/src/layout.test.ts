// The geometry of the table: the anchors, the fan, the compression and the drop
// rectangles (specs/table.md).

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
import type { CardState, CascadeState, Suit } from "./game";
import {
  columnBottom,
  columnCardY,
  dropRect,
  faceUpOffsetFor,
  inRect,
  pileAnchor,
  pileAt,
  wasteShownCards,
  wasteVisibleCount,
} from "./layout";

let nextId = 0;

function card(faceUp: boolean, suit: Suit = "spades", rank = 5): CardState {
  nextId += 1;
  return { id: nextId, suit, rank, faceUp };
}

function column(faces: readonly boolean[]): CardState[] {
  return faces.map((faceUp) => card(faceUp));
}

/** A bare state with the piles a geometry question needs. */
function table(overrides: Partial<CascadeState> = {}): CascadeState {
  return {
    stock: [],
    waste: [],
    wasteSets: [],
    foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
    ...overrides,
  } as unknown as CascadeState;
}

describe("the anchors", () => {
  it("puts the top row and the columns where the specification fixes them", () => {
    expect(pileAnchor("stock", 0)).toEqual([STOCK_X, TOP_ROW_Y]);
    expect(pileAnchor("waste", 0)).toEqual([WASTE_X, TOP_ROW_Y]);
    for (let i = 0; i < 4; i += 1) {
      expect(pileAnchor("foundation", i)).toEqual([FOUNDATION_X[i], TOP_ROW_Y]);
    }
    for (let i = 0; i < 7; i += 1) {
      expect(pileAnchor("tableau", i)).toEqual([COLUMN_X[i], TABLEAU_Y]);
    }
    expect(COLUMN_X).toEqual([224, 346, 468, 590, 712, 834, 956]);
    expect(FOUNDATION_X).toEqual([590, 712, 834, 956]);
  });

  it("leaves the third top-row position empty", () => {
    expect(FOUNDATION_X).not.toContain(COLUMN_X[2]);
    expect([STOCK_X, WASTE_X]).not.toContain(COLUMN_X[2]);
  });
});

describe("a column's fan", () => {
  it("offsets a card by 24 under a face-down card and 34 under a face-up one", () => {
    const cards = column([false, false, true, true]);
    expect(columnCardY(cards, 0)).toBe(TABLEAU_Y);
    expect(columnCardY(cards, 1)).toBe(TABLEAU_Y + FACE_DOWN_OFFSET);
    expect(columnCardY(cards, 2)).toBe(TABLEAU_Y + 2 * FACE_DOWN_OFFSET);
    expect(columnCardY(cards, 3)).toBe(
      TABLEAU_Y + 2 * FACE_DOWN_OFFSET + FACE_UP_OFFSET,
    );
  });

  it("draws the full offset while the column fits above the limit", () => {
    const cards = column([true, true, true, true, true, true, true, true, true, true, true]);
    expect(faceUpOffsetFor(cards)).toBe(FACE_UP_OFFSET);
    expect(columnBottom(cards)).toBeLessThanOrEqual(COLUMN_BOTTOM_LIMIT);
  });

  it("compresses a long column uniformly to the limit", () => {
    const cards = column(Array.from({ length: 14 }, () => true));
    const offset = faceUpOffsetFor(cards);
    expect(offset).toBeLessThan(FACE_UP_OFFSET);
    expect(offset).toBeGreaterThanOrEqual(FACE_UP_OFFSET_MIN);
    expect(columnBottom(cards)).toBeCloseTo(COLUMN_BOTTOM_LIMIT, 6);

    const gaps: number[] = [];
    for (let row = 1; row < cards.length; row += 1) {
      gaps.push(columnCardY(cards, row) - columnCardY(cards, row - 1));
    }
    for (const gap of gaps) expect(gap).toBeCloseTo(offset, 9);
  });

  it("never draws a face-up offset below the floor", () => {
    const cards = column(Array.from({ length: 40 }, () => true));
    expect(faceUpOffsetFor(cards)).toBe(FACE_UP_OFFSET_MIN);
    expect(columnBottom(cards)).toBeGreaterThan(COLUMN_BOTTOM_LIMIT);
  });

  it("leaves the face-down offset alone however far it compresses", () => {
    const faces = [false, false, false, ...Array.from({ length: 14 }, () => true)];
    const cards = column(faces);
    expect(faceUpOffsetFor(cards)).toBeLessThan(FACE_UP_OFFSET);
    expect(columnCardY(cards, 1) - columnCardY(cards, 0)).toBe(FACE_DOWN_OFFSET);
    expect(columnCardY(cards, 2) - columnCardY(cards, 1)).toBe(FACE_DOWN_OFFSET);
  });

  it("expands again once the column has lost cards", () => {
    const cards = column(Array.from({ length: 16 }, () => true));
    expect(faceUpOffsetFor(cards)).toBeLessThan(FACE_UP_OFFSET);
    cards.length = 6;
    expect(faceUpOffsetFor(cards)).toBe(FACE_UP_OFFSET);
  });
});

describe("the drop rectangles", () => {
  it("gives the top row and an empty column the card's own footprint", () => {
    const state = table();
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
    expect(dropRect(state, "foundation", 2)).toEqual({
      x: FOUNDATION_X[2],
      y: TOP_ROW_Y,
      w: CARD_W,
      h: CARD_H,
    });
    expect(dropRect(state, "tableau", 4)).toEqual({
      x: COLUMN_X[4],
      y: TABLEAU_Y,
      w: CARD_W,
      h: CARD_H,
    });
  });

  it("runs a column's rectangle down to its lowest drawn card", () => {
    const tableau: CardState[][] = [[], [], [], [], [], [], []];
    tableau[1] = column([true, true, true]);
    const state = table({ tableau });
    const rect = dropRect(state, "tableau", 1);
    expect(rect.y).toBe(TABLEAU_Y);
    expect(rect.y + rect.h).toBe(columnBottom(tableau[1]));
  });

  it("leaves no point in two rectangles at once", () => {
    const tableau: CardState[][] = [[], [], [], [], [], [], []];
    for (let i = 0; i < 7; i += 1) tableau[i] = column([true, true, true, true]);
    const state = table({ tableau });
    for (let x = 0; x < 1280; x += 7) {
      for (let y = 0; y < 720; y += 11) {
        const hits = (
          [
            ["stock", 0],
            ["waste", 0],
            ["foundation", 0],
            ["foundation", 1],
            ["foundation", 2],
            ["foundation", 3],
            ...Array.from({ length: 7 }, (_, i) => ["tableau", i]),
          ] as [Parameters<typeof dropRect>[1], number][]
        ).filter(([pile, index]) => inRect(dropRect(state, pile, index), x, y));
        expect(hits.length, `${x},${y}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("finds the pile a point lies on, and none in the gaps", () => {
    const state = table();
    expect(pileAt(state, STOCK_X + 10, TOP_ROW_Y + 10)).toEqual({
      pile: "stock",
      index: 0,
    });
    expect(pileAt(state, FOUNDATION_X[1] + 50, TOP_ROW_Y + 70)).toEqual({
      pile: "foundation",
      index: 1,
    });
    expect(pileAt(state, COLUMN_X[3] + 50, TABLEAU_Y + 50)).toEqual({
      pile: "tableau",
      index: 3,
    });
    // The gap between two columns, and the empty third top-row position.
    expect(pileAt(state, COLUMN_X[0] + CARD_W + 11, TABLEAU_Y + 50)).toBeNull();
    expect(pileAt(state, COLUMN_X[2] + 50, TOP_ROW_Y + 70)).toBeNull();
  });
});

describe("the waste", () => {
  it("shows the newest set's cards and nothing when the memory is empty", () => {
    const waste = [card(true), card(true), card(true)];
    expect(wasteVisibleCount(table({ waste, wasteSets: [1, 1] }))).toBe(1);
    expect(wasteShownCards(table({ waste, wasteSets: [1, 1] }))).toEqual([
      waste[2],
    ]);
    expect(wasteVisibleCount(table({ waste, wasteSets: [] }))).toBe(0);
    expect(wasteShownCards(table({ waste, wasteSets: [] }))).toEqual([]);
  });

  it("never shows more cards than the waste holds", () => {
    const waste = [card(true)];
    expect(wasteShownCards(table({ waste, wasteSets: [3] }))).toHaveLength(1);
  });
});
