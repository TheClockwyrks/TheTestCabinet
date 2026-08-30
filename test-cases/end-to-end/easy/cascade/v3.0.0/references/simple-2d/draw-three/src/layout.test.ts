// The geometry of the table: anchors, offsets, compression and drop rectangles.

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
  cardAt,
  columnBottom,
  columnCardTops,
  drawnCards,
  dropRect,
  dropZones,
  faceUpOffset,
  pileAnchor,
  rectContains,
  wasteFanX,
  wasteShownCount,
  zoneAt,
  type BoardView,
  type CardView,
} from "./layout";
import type { Suit } from "./game";

let nextId = 1;
function card(suit: Suit, rank: number, faceUp = true): CardView {
  return { id: nextId++, suit, rank, faceUp };
}

function board(patch: Partial<BoardView> = {}): BoardView {
  return {
    stock: [],
    waste: [],
    wasteSets: [],
    foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
    ...patch,
  };
}

function column(size: number, faceDown = 0): CardView[] {
  return Array.from({ length: size }, (_, i) =>
    card("spades", (i % 13) + 1, i >= faceDown),
  );
}

describe("the anchors", () => {
  it("puts the top row at its fixed positions", () => {
    expect(pileAnchor("stock", 0)).toEqual({ x: STOCK_X, y: TOP_ROW_Y });
    expect(pileAnchor("waste", 0)).toEqual({ x: WASTE_X, y: TOP_ROW_Y });
    for (let i = 0; i < 4; i++) {
      expect(pileAnchor("foundation", i)).toEqual({
        x: FOUNDATION_X[i] as number,
        y: TOP_ROW_Y,
      });
    }
  });

  it("puts the seven columns at their pitch", () => {
    for (let i = 0; i < 7; i++) {
      expect(pileAnchor("tableau", i)).toEqual({
        x: COLUMN_X[i] as number,
        y: TABLEAU_Y,
      });
    }
    expect((COLUMN_X[1] as number) - (COLUMN_X[0] as number)).toBe(122);
  });
});

describe("a column's fan", () => {
  it("offsets a card under a face-up card by 34 and under a face-down by 24", () => {
    const cards = [
      card("spades", 5, false),
      card("hearts", 4),
      card("clubs", 3),
    ];
    const tops = columnCardTops(cards);
    expect(tops[0]).toBe(TABLEAU_Y);
    expect((tops[1] as number) - (tops[0] as number)).toBe(FACE_DOWN_OFFSET);
    expect((tops[2] as number) - (tops[1] as number)).toBe(FACE_UP_OFFSET);
  });

  it("leaves a short column uncompressed", () => {
    expect(faceUpOffset(column(6))).toBe(FACE_UP_OFFSET);
  });

  it("compresses a long column to fit above the limit", () => {
    const cards = column(19);
    expect(faceUpOffset(cards)).toBeLessThan(FACE_UP_OFFSET);
    expect(columnBottom(cards)).toBeLessThanOrEqual(COLUMN_BOTTOM_LIMIT + 1e-9);
  });

  it("never compresses past the floor", () => {
    expect(faceUpOffset(column(60))).toBe(FACE_UP_OFFSET_MIN);
  });

  it("leaves the face-down offset alone however far it compresses", () => {
    const cards = column(24, 6);
    const tops = columnCardTops(cards);
    expect((tops[1] as number) - (tops[0] as number)).toBe(FACE_DOWN_OFFSET);
    expect(faceUpOffset(cards)).toBeLessThan(FACE_UP_OFFSET);
  });

  it("expands again once the column has lost cards", () => {
    const long = column(19);
    expect(faceUpOffset(long)).toBeLessThan(FACE_UP_OFFSET);
    expect(faceUpOffset(long.slice(0, 6))).toBe(FACE_UP_OFFSET);
  });
});

describe("the waste", () => {
  it("shows the newest set, held to the cards it holds", () => {
    expect(
      wasteShownCount(board({ waste: column(5), wasteSets: [3, 2] })),
    ).toBe(2);
    expect(wasteShownCount(board({ waste: column(5), wasteSets: [] }))).toBe(0);
    expect(wasteShownCount(board({ waste: column(1), wasteSets: [3] }))).toBe(
      1,
    );
  });

  it("fans at the pitch and never passes 498", () => {
    expect(wasteFanX(0)).toBe(WASTE_X);
    expect(wasteFanX(1)).toBe(372);
    expect(wasteFanX(2)).toBe(398);
    expect(wasteFanX(2) + CARD_W).toBe(498);
  });

  it("squares away every card behind the shown set", () => {
    const view = board({ waste: column(5), wasteSets: [3, 2] });
    const drawn = drawnCards(view).filter((p) => p.pile === "waste");
    expect(drawn).toHaveLength(5);
    expect(drawn.slice(0, 3).every((p) => p.x === WASTE_X)).toBe(true);
    expect(drawn[3]?.x).toBe(WASTE_X);
    expect(drawn[4]?.x).toBe(372);
  });

  it("draws nothing at all when its set memory is empty", () => {
    const view = board({ waste: column(5), wasteSets: [] });
    expect(drawnCards(view).filter((p) => p.pile === "waste")).toHaveLength(0);
  });
});

describe("the drop rectangles", () => {
  it("gives every top-row pile one card's footprint", () => {
    expect(dropRect(board(), "stock", 0)).toEqual({
      x: STOCK_X,
      y: TOP_ROW_Y,
      w: CARD_W,
      h: CARD_H,
    });
    expect(dropRect(board(), "foundation", 2)).toEqual({
      x: FOUNDATION_X[2] as number,
      y: TOP_ROW_Y,
      w: CARD_W,
      h: CARD_H,
    });
  });

  it("runs a column's rectangle down to its lowest drawn card", () => {
    const view = board({ tableau: [column(4), [], [], [], [], [], []] });
    const rect = dropRect(view, "tableau", 0);
    expect(rect.y).toBe(TABLEAU_Y);
    expect(rect.h).toBe(columnBottom(column(4)) - TABLEAU_Y);
  });

  it("overlaps nowhere, so a point lies in at most one", () => {
    const view = board({
      tableau: [
        column(9),
        column(3),
        column(1),
        [],
        column(7),
        column(2),
        column(13),
      ],
    });
    const zones = dropZones(view);
    for (let i = 0; i < zones.length; i++) {
      for (let j = i + 1; j < zones.length; j++) {
        const a = (zones[i] as (typeof zones)[number]).rect;
        const b = (zones[j] as (typeof zones)[number]).rect;
        const overlaps =
          a.x < b.x + b.w &&
          b.x < a.x + a.w &&
          a.y < b.y + b.h &&
          b.y < a.y + a.h;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("answers a point on no pile with nothing", () => {
    expect(zoneAt(board(), 20, 400)).toBeNull();
    expect(zoneAt(board(), 468, TOP_ROW_Y + 10)).toBeNull();
    expect(zoneAt(board(), STOCK_X + 5, TOP_ROW_Y + 5)?.pile).toBe("stock");
  });
});

describe("the topmost card at a point", () => {
  it("is the lowest of the cards a column draws there", () => {
    const cards = column(4);
    const view = board({ tableau: [cards, [], [], [], [], [], []] });
    const tops = columnCardTops(cards);
    const hit = cardAt(
      view,
      (COLUMN_X[0] as number) + 10,
      (tops[3] as number) + 5,
    );
    expect(hit?.row).toBe(3);
  });

  it("is nothing where no card is drawn", () => {
    expect(cardAt(board(), 640, 400)).toBeNull();
  });

  it("agrees with the rectangle it was found in", () => {
    const view = board({ stock: column(2, 2) });
    const hit = cardAt(view, STOCK_X + 1, TOP_ROW_Y + 1);
    expect(hit?.pile).toBe("stock");
    expect(
      rectContains(
        { x: STOCK_X, y: TOP_ROW_Y, w: CARD_W, h: CARD_H },
        STOCK_X,
        TOP_ROW_Y,
      ),
    ).toBe(true);
  });
});
