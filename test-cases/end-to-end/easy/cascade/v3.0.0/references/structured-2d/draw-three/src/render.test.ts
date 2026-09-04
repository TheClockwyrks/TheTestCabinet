import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CARD_H,
  CARD_W,
  COLUMN_X,
  DEAL_MODE_LABEL,
  FOUNDATION_X,
  HUD_H,
  HUD_ITEMS,
  HUD_Y,
  STOCK_X,
  TABLEAU_Y,
  TAGLINE_TEXT,
  TITLE_ITEMS,
  TITLE_TEXT,
  TOP_ROW_Y,
  WASTE_FAN,
  WASTE_X,
  WIN_TEXT,
} from "./constants";
import { HUD_MENU, HUD_NEW_GAME, HUD_SOUND } from "./menus";
import type { Rect } from "./layout";
import {
  colorDistance,
  createHarness,
  openTable,
  poseColumn,
  poseFoundation,
  poseWaste,
  recordText,
  startCascade,
  type Harness,
} from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  openTable(h);
});

afterEach(() => {
  h.dispose();
});

/** A patch of bare felt, well clear of every pile. */
function felt(): [number, number, number] {
  return h.pixel(40, 600);
}

/**
 * The strongest contrast any pixel of a band shows against a reference colour,
 * sampled on a coarse grid. A glyph's ink covers a fraction of the band it is
 * drawn in, so a check that text READS is a check that some pixel of that band
 * stands apart from what sits behind it, rather than a check on one point that a
 * different type or size would place between two letters.
 */
function contrastIn(rect: Rect, against: [number, number, number]): number {
  let best = 0;
  for (let x = rect.x; x < rect.x + rect.w; x += 3) {
    for (let y = rect.y; y < rect.y + rect.h; y += 3) {
      best = Math.max(best, colorDistance(h.pixel(x, y), against));
    }
  }
  return best;
}

function inside(rect: Rect, text: { x: number; y: number }): boolean {
  return (
    text.x >= rect.x - 2 &&
    text.x <= rect.x + rect.w + 2 &&
    text.y >= rect.y - 2 &&
    text.y <= rect.y + rect.h + 2
  );
}

describe("what a player reads at a glance", () => {
  it("draws a card over its whole footprint, at its top-left", async () => {
    poseColumn(h, 2, [{ suit: "hearts", rank: 7 }]);
    await h.advance(1);
    const x = COLUMN_X[2];
    for (const [px, py] of [
      [x + 4, TABLEAU_Y + 4],
      [x + CARD_W - 4, TABLEAU_Y + 4],
      [x + 4, TABLEAU_Y + CARD_H - 4],
      [x + CARD_W - 4, TABLEAU_Y + CARD_H - 4],
    ]) {
      expect(colorDistance(h.pixel(px, py), felt())).toBeGreaterThan(90);
    }
    // And nothing card-sized in the 22-unit gap beside it.
    expect(colorDistance(h.pixel(x - 11, TABLEAU_Y + 70), felt())).toBeLessThan(
      10,
    );
  });

  it("tells a red suit from a black one", async () => {
    poseColumn(h, 0, [{ suit: "hearts", rank: 7 }]);
    poseColumn(h, 1, [{ suit: "spades", rank: 7 }]);
    await h.advance(1);
    const red = h.pixel(COLUMN_X[0] + CARD_W / 2, TABLEAU_Y + CARD_H / 2);
    const black = h.pixel(COLUMN_X[1] + CARD_W / 2, TABLEAU_Y + CARD_H / 2);
    expect(colorDistance(red, black)).toBeGreaterThan(90);
  });

  it("tells a back from a face, and both from the felt", async () => {
    poseColumn(h, 0, [{ suit: "hearts", rank: 7 }]);
    poseColumn(h, 1, [{ suit: "spades", rank: 7, faceUp: false }]);
    await h.advance(1);
    const face = h.pixel(COLUMN_X[0] + 12, TABLEAU_Y + 100);
    const back = h.pixel(COLUMN_X[1] + 50, TABLEAU_Y + 70);
    expect(colorDistance(back, face)).toBeGreaterThan(90);
    expect(colorDistance(back, felt())).toBeGreaterThan(60);
    expect(colorDistance(face, felt())).toBeGreaterThan(90);
  });

  it("draws an empty slot at every empty pile, apart from the felt", async () => {
    await h.advance(1);
    const anchors: [number, number][] = [
      [STOCK_X, TOP_ROW_Y],
      [WASTE_X, TOP_ROW_Y],
      ...FOUNDATION_X.map((x) => [x, TOP_ROW_Y] as [number, number]),
      ...COLUMN_X.map((x) => [x, TABLEAU_Y] as [number, number]),
    ];
    for (const [x, y] of anchors) {
      expect(
        colorDistance(h.pixel(x + CARD_W / 2, y + CARD_H / 2), felt()),
      ).toBeGreaterThan(30);
    }
    // The third top-row column position carries no pile.
    expect(
      colorDistance(h.pixel(468 + 50, TOP_ROW_Y + 70), felt()),
    ).toBeLessThan(10);
  });

  it("draws the waste's shown set fanned right, and its slot when it shows none", async () => {
    poseWaste(
      h,
      [
        { suit: "hearts", rank: 3 },
        { suit: "spades", rank: 4 },
        { suit: "hearts", rank: 5 },
      ],
      [3],
    );
    await h.advance(1);
    for (let i = 0; i < 3; i += 1) {
      const x = WASTE_X + i * WASTE_FAN;
      expect(
        colorDistance(h.pixel(x + 6, TOP_ROW_Y + 70), felt()),
        `card ${i}`,
      ).toBeGreaterThan(90);
    }
    // The fan's right edge stays clear of the first foundation.
    expect(WASTE_X + 2 * WASTE_FAN + CARD_W).toBeLessThan(FOUNDATION_X[0]);

    h.debug.clearWasteSets();
    await h.advance(1);
    const slot = h.pixel(WASTE_X + CARD_W / 2, TOP_ROW_Y + CARD_H / 2);
    const emptyColumn = h.pixel(
      COLUMN_X[6] + CARD_W / 2,
      TABLEAU_Y + CARD_H / 2,
    );
    expect(colorDistance(slot, emptyColumn)).toBeLessThan(10);
  });

  it("draws a held run above the piles it passes over", async () => {
    poseColumn(h, 0, [{ suit: "hearts", rank: 7 }]);
    poseColumn(h, 1, [{ suit: "spades", rank: 9, faceUp: false }]);
    await h.advance(1);
    const covered = h.pixel(COLUMN_X[1] + 50, TABLEAU_Y + 70);

    h.debug.pointerDown(COLUMN_X[0] + 50, TABLEAU_Y + 70);
    h.debug.pointerMove(COLUMN_X[1] + 50, TABLEAU_Y + 70);
    await h.advance(1);
    const lifted = h.pixel(COLUMN_X[1] + 50, TABLEAU_Y + 70);
    expect(colorDistance(lifted, covered)).toBeGreaterThan(60);
  });

  it("draws a legal drop target apart from the same pile unhighlighted", async () => {
    poseFoundation(h, 0, "hearts", 2);
    poseColumn(h, 0, [{ suit: "hearts", rank: 3 }]);
    await h.advance(1);
    // Just beyond the foundation's right edge, so the reading is of the pile's
    // own mark rather than of the card held over it: the run is grabbed 20 units
    // in from its left edge and carried to x = 600, which puts the held card's
    // centre inside the foundation's drop rectangle while its right edge stops
    // short of that rectangle's.
    const edgeX = FOUNDATION_X[0] + CARD_W + 2;
    const plain = h.pixel(edgeX, TOP_ROW_Y + 70);

    h.debug.pointerDown(COLUMN_X[0] + 20, TABLEAU_Y + 70);
    h.debug.pointerMove(600, TOP_ROW_Y + 70);
    expect(h.debug.snapshot().dropTarget).toEqual({
      pile: "foundation",
      index: 0,
    });
    await h.advance(1);
    const lit = h.pixel(edgeX, TOP_ROW_Y + 70);
    expect(colorDistance(lit, plain)).toBeGreaterThan(60);
  });
});

describe("the text the screens draw", () => {
  it("names the game, its tagline, both items and the deal mode on the title", async () => {
    h.debug.reset();
    const drawn = await recordText(h);
    const strings = drawn.map((entry) => entry.text);
    expect(strings).toContain(TITLE_TEXT);
    expect(strings).toContain(TAGLINE_TEXT);
    expect(strings).toContain(TITLE_ITEMS[0]);
    expect(strings).toContain(TITLE_ITEMS[1]);
    expect(strings).toContain(DEAL_MODE_LABEL);
    expect(DEAL_MODE_LABEL).toBe(h.debug.snapshot().dealModeLabel);
  });

  it("carries each token the how-to screen must name, at word boundaries", async () => {
    h.debug.setScreen("howto");
    const drawn = await recordText(h);
    const copy = drawn.map((entry) => entry.text).join(" ");
    for (const token of ["ACE", "KING", "STOCK", "DOUBLE-CLICK"]) {
      expect(
        new RegExp(`(^|[^A-Z-])${token}([^A-Z-]|$)`).test(copy),
        token,
      ).toBe(true);
    }
    expect(drawn.map((entry) => entry.text)).toContain("BACK");
  });

  it("draws each HUD label inside its own rectangle, and the deal mode in the strip", async () => {
    const drawn = await recordText(h);
    const rects: Rect[] = [HUD_NEW_GAME, HUD_MENU, HUD_SOUND];
    HUD_ITEMS.forEach((label, i) => {
      const entry = drawn.find((item) => item.text === label);
      expect(entry, label).toBeDefined();
      expect(entry !== undefined && inside(rects[i], entry), label).toBe(true);
    });
    const mode = drawn.find((item) => item.text === DEAL_MODE_LABEL);
    expect(mode).toBeDefined();
    expect((mode?.y ?? 0) >= HUD_Y && (mode?.y ?? 0) <= HUD_Y + HUD_H).toBe(
      true,
    );
  });

  it("draws its text legibly against what sits behind it", async () => {
    h.debug.reset();
    await h.advance(1);
    // The title's own ink against the felt, read over the band the title is
    // drawn across.
    const feltCorner = h.pixel(60, 60);
    expect(
      contrastIn({ x: 400, y: 150, w: 480, h: 84 }, feltCorner),
    ).toBeGreaterThan(60);

    h.debug.setScreen("playing");
    await h.advance(1);
    // A HUD label against the plate it is drawn on.
    const plate = h.pixel(HUD_NEW_GAME.x + 4, HUD_NEW_GAME.y + 4);
    expect(contrastIn(HUD_NEW_GAME, plate)).toBeGreaterThan(60);
  });

  it("shows the win message once the cascade is done", async () => {
    h.debug.setTrailPainting(false);
    startCascade(h);
    for (let i = 0; i < 60 && !h.debug.snapshot().cascadeDone; i += 1) {
      await h.advance(30);
    }
    expect(h.debug.snapshot().cascadeDone).toBe(true);
    const drawn = await recordText(h);
    expect(drawn.map((entry) => entry.text)).toContain(WIN_TEXT);
  });
});

describe("the painted table", () => {
  it("keeps a flyer's stamp long after the flyer has moved on", async () => {
    h.debug.addFlyer("hearts", 5, 300, 400, 240, -100);
    // One frame leaves exactly one stamp, and the gate closed after it keeps the
    // flyer from overdrawing its own first stamp as it travels, so what is read
    // below is that one stamp for the rest of the flight.
    await h.advance(1);
    h.debug.setTrailPainting(false);
    expect(h.debug.snapshot().trailStamps).toBe(1);

    // Far enough along for the flyer itself to have left the stamp's footprint.
    await h.advance(60);
    const painted = h.pixel(390, 420);
    expect(colorDistance(painted, felt())).toBeGreaterThan(90);
    await h.advance(120);
    expect(colorDistance(h.pixel(390, 420), painted)).toBeLessThan(20);
  });

  it("paints a growing share of the table as the cascade runs", async () => {
    const painted = (): number => {
      let count = 0;
      for (let x = 10; x < 1270; x += 20) {
        for (let y = 200; y < 700; y += 20) {
          if (colorDistance(h.pixel(x, y), felt()) > 60) count += 1;
        }
      }
      return count;
    };
    startCascade(h);
    await h.advance(60);
    const early = painted();
    await h.advance(180);
    expect(painted()).toBeGreaterThan(early);
  });

  it("keeps the unlaunched foundations drawn above it", async () => {
    h.debug.setTrailPainting(false);
    startCascade(h);
    await h.advance(30);
    const remaining = h.debug
      .snapshot()
      .foundations.findIndex((pile) => pile.length > 0);
    expect(remaining).toBeGreaterThanOrEqual(0);
    // Read off the card's body rather than its middle, where the suit's own pip
    // is drawn: a black pip on a light face is the one point of a card that a
    // dark table does not stand apart from.
    expect(
      colorDistance(
        h.pixel(FOUNDATION_X[remaining] + 50, TOP_ROW_Y + 20),
        felt(),
      ),
    ).toBeGreaterThan(90);
  });

  it("stays painted once the cascade is over", async () => {
    startCascade(h);
    for (let i = 0; i < 60 && !h.debug.snapshot().cascadeDone; i += 1) {
      await h.advance(30);
    }
    expect(h.debug.snapshot().cascadeDone).toBe(true);
    expect(colorDistance(h.pixel(640, 640), felt())).toBeGreaterThan(60);
  });
});
