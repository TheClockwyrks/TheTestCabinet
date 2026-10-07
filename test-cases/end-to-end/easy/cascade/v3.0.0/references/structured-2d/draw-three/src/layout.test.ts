import { describe, expect, it } from "vitest";
import {
  CARD_H,
  COLUMN_BOTTOM_LIMIT,
  FACE_DOWN_OFFSET,
  FACE_UP_OFFSET,
  FACE_UP_OFFSET_MIN,
  TABLEAU_Y,
} from "./constants";
import { CascadeState, type CardState, type Suit } from "./game";
import {
  cardAtPoint,
  columnBottom,
  columnCardYs,
  drawnCards,
  dropRect,
  faceUpOffsetOf,
  pileAnchor,
  pileAtPoint,
  rectContains,
  wasteFanXs,
} from "./layout";

let next = 1;
function card(suit: Suit, rank: number, faceUp = true): CardState {
  next += 1;
  return { id: next, suit, rank, faceUp };
}

function faceUpRun(count: number): CardState[] {
  return Array.from({ length: count }, (_, i) => card("spades", 13 - (i % 13)));
}

describe("the pile anchors", () => {
  it("puts the top row and the seven columns where the table fixes them", () => {
    expect(pileAnchor("stock", 0)).toEqual({ x: 224, y: 24 });
    expect(pileAnchor("waste", 0)).toEqual({ x: 346, y: 24 });
    expect(pileAnchor("foundation", 0)).toEqual({ x: 590, y: 24 });
    expect(pileAnchor("foundation", 3)).toEqual({ x: 956, y: 24 });
    expect(pileAnchor("tableau", 0)).toEqual({ x: 224, y: 180 });
    expect(pileAnchor("tableau", 6)).toEqual({ x: 956, y: 180 });
  });

  it("names nothing outside the thirteen", () => {
    expect(pileAnchor("foundation", 4)).toBeNull();
    expect(pileAnchor("tableau", 7)).toBeNull();
    expect(pileAnchor("waste", 1)).toBeNull();
  });
});

describe("a column's fan", () => {
  it("offsets a card 24 under a face-down card and 34 under a face-up one", () => {
    const cards = [
      card("spades", 5, false),
      card("hearts", 4),
      card("clubs", 3),
    ];
    expect(columnCardYs(cards)).toEqual([
      TABLEAU_Y,
      TABLEAU_Y + FACE_DOWN_OFFSET,
      TABLEAU_Y + FACE_DOWN_OFFSET + FACE_UP_OFFSET,
    ]);
  });

  it("draws the full offset while the column fits above the limit", () => {
    expect(faceUpOffsetOf(faceUpRun(6))).toBe(FACE_UP_OFFSET);
  });

  it("compresses a long column to sit on the limit exactly", () => {
    const cards = faceUpRun(14);
    const step = faceUpOffsetOf(cards);
    expect(step).toBeLessThan(FACE_UP_OFFSET);
    expect(columnBottom(cards)).toBeCloseTo(COLUMN_BOTTOM_LIMIT, 6);
  });

  it("compresses uniformly, so every face-up gap is the same", () => {
    const ys = columnCardYs(faceUpRun(14));
    const gaps = ys.slice(1).map((y, i) => y - ys[i]);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 9);
  });

  it("never falls below the floor, however long the column", () => {
    expect(faceUpOffsetOf(faceUpRun(40))).toBe(FACE_UP_OFFSET_MIN);
  });

  it("leaves the face-down offset alone in a compressed column", () => {
    const cards = [
      ...Array.from({ length: 4 }, () => card("spades", 5, false)),
      ...faceUpRun(12),
    ];
    const ys = columnCardYs(cards);
    for (let i = 1; i <= 4; i += 1) {
      expect(ys[i] - ys[i - 1]).toBe(FACE_DOWN_OFFSET);
    }
    expect(ys[6] - ys[5]).toBeLessThan(FACE_UP_OFFSET);
  });

  it("relaxes back to the full offset once the column is shorter", () => {
    const cards = faceUpRun(14);
    expect(faceUpOffsetOf(cards)).toBeLessThan(FACE_UP_OFFSET);
    cards.length = 5;
    expect(faceUpOffsetOf(cards)).toBe(FACE_UP_OFFSET);
  });

  it("reads an empty column's bottom at its own slot", () => {
    expect(columnBottom([])).toBe(TABLEAU_Y + CARD_H);
  });
});

describe("the waste's fan", () => {
  it("fans the shown cards right from the anchor at the stated pitch", () => {
    expect(wasteFanXs(3)).toEqual([346, 372, 398]);
    expect(wasteFanXs(2)).toEqual([346, 372]);
    expect(wasteFanXs(1)).toEqual([346]);
    expect(wasteFanXs(0)).toEqual([]);
  });

  it("keeps the fan's right edge clear of the first foundation", () => {
    const xs = wasteFanXs(3);
    expect(xs[0]).toBeGreaterThanOrEqual(346);
    expect(xs[xs.length - 1] + 100).toBeLessThan(590);
  });

  it("squares everything beyond three cards at the anchor", () => {
    expect(wasteFanXs(5)).toEqual([346, 346, 346, 372, 398]);
  });
});

describe("the drop rectangles", () => {
  const state = new CascadeState();

  it("gives the top row the card footprint at its anchor", () => {
    expect(dropRect(state, "stock", 0)).toEqual({
      x: 224,
      y: 24,
      w: 100,
      h: 140,
    });
    expect(dropRect(state, "waste", 0)).toEqual({
      x: 346,
      y: 24,
      w: 100,
      h: 140,
    });
    expect(dropRect(state, "foundation", 2)).toEqual({
      x: 834,
      y: 24,
      w: 100,
      h: 140,
    });
  });

  it("gives an empty column the card footprint at its anchor", () => {
    expect(dropRect(state, "tableau", 1)).toEqual({
      x: 346,
      y: 180,
      w: 100,
      h: 140,
    });
  });

  it("runs a filled column's rectangle to its lowest card's bottom edge", () => {
    const posed = new CascadeState();
    posed.tableau[3] = faceUpRun(3);
    const rect = dropRect(posed, "tableau", 3);
    expect(rect).not.toBeNull();
    expect(rect?.y).toBe(TABLEAU_Y);
    expect((rect?.y ?? 0) + (rect?.h ?? 0)).toBe(
      columnBottom(posed.tableau[3]),
    );
  });

  it("leaves no two rectangles overlapping, so a point lies in at most one", () => {
    const posed = new CascadeState();
    posed.tableau = posed.tableau.map(() => faceUpRun(12));
    for (let x = 0; x < 1280; x += 7) {
      for (let y = 0; y < 720; y += 7) {
        let hits = 0;
        for (const ref of [
          { pile: "stock" as const, index: 0 },
          { pile: "waste" as const, index: 0 },
          ...[0, 1, 2, 3].map((index) => ({
            pile: "foundation" as const,
            index,
          })),
          ...[0, 1, 2, 3, 4, 5, 6].map((index) => ({
            pile: "tableau" as const,
            index,
          })),
        ]) {
          const rect = dropRect(posed, ref.pile, ref.index);
          if (rect !== null && rectContains(rect, x, y)) hits += 1;
        }
        expect(hits).toBeLessThanOrEqual(1);
      }
    }
  });

  it("resolves a point on a pile, and none in the gaps between them", () => {
    const posed = new CascadeState();
    posed.tableau[0] = faceUpRun(3);
    expect(pileAtPoint(posed, 274, 94)).toEqual({ pile: "stock", index: 0 });
    expect(pileAtPoint(posed, 274, 250)).toEqual({ pile: "tableau", index: 0 });
    // The 22-unit gap between two columns, and the empty third top-row slot.
    expect(pileAtPoint(posed, 335, 250)).toBeNull();
    expect(pileAtPoint(posed, 500, 94)).toBeNull();
    // The HUD strip carries no pile.
    expect(pileAtPoint(posed, 640, 700)).toBeNull();
  });
});

describe("what a point lies on", () => {
  it("finds the lowest of a column's cards at the point", () => {
    const posed = new CascadeState();
    posed.tableau[0] = faceUpRun(3);
    const hit = cardAtPoint(posed, 274, 350);
    expect(hit?.pile).toBe("tableau");
    expect(hit?.row).toBe(2);
  });

  it("finds the frontmost fanned card on the waste", () => {
    const posed = new CascadeState();
    posed.waste = faceUpRun(5);
    posed.wasteSets = [2, 3];
    expect(cardAtPoint(posed, 450, 90)?.row).toBe(4);
    expect(cardAtPoint(posed, 355, 90)?.row).toBe(2);
  });

  it("draws no waste card at all while the set memory is empty", () => {
    const posed = new CascadeState();
    posed.waste = faceUpRun(3);
    posed.wasteSets = [];
    expect(cardAtPoint(posed, 380, 90)).toBeNull();
    expect(drawnCards(posed).some((entry) => entry.pile === "waste")).toBe(
      false,
    );
  });

  it("shows the stock's and a foundation's top card alone", () => {
    const posed = new CascadeState();
    posed.stock = faceUpRun(4);
    posed.foundations[1] = faceUpRun(2);
    const drawn = drawnCards(posed);
    expect(drawn.filter((entry) => entry.pile === "stock")).toHaveLength(1);
    expect(drawn.filter((entry) => entry.pile === "foundation")).toHaveLength(
      1,
    );
  });

  it("finds nothing on the bare table", () => {
    expect(cardAtPoint(new CascadeState(), 640, 500)).toBeNull();
  });
});
