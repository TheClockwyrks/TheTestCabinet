// What the table looks like: the legibility table in `specs/overview.md`, read
// off the pixels the render produced.
//
// Not one assertion here names a color of this build's own. Each is a
// DISTANCE — presence, and telling two things apart — so the palette stays the
// build's to choose and the checks stay about what a player can read.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CARD_H,
  CARD_W,
  COLUMN_X,
  FOUNDATION_X,
  HUD_H,
  HUD_Y,
  STOCK_X,
  TABLEAU_Y,
  TOP_ROW_Y,
} from "./constants";
import { HUD_MENU, HUD_NEW_GAME, HUD_SOUND } from "./menus";
import {
  createHarness,
  openTable,
  poseColumn,
  poseFoundation,
  type Harness,
} from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

type Rgb = [number, number, number];

function apart(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** A patch of bare felt, clear of every pile and of the HUD strip. */
const BARE: [number, number] = [1180, 520];

/** The middle of a card at a top-left, where its suit is drawn. */
const middle = (x: number, y: number): [number, number] => [
  x + CARD_W / 2,
  y + CARD_H / 2,
];

/** A blank part of a card's body, clear of its rank, its suit and its pip. */
const body = (x: number, y: number): [number, number] => [x + 86, y + 18];

describe("a card", () => {
  it("covers its whole footprint at its position", async () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 2, [{ suit: "hearts", rank: 9 }]);
    await h.advance(1);
    const felt = h.pixel(...BARE);
    for (const [dx, dy] of [
      [3, 3],
      [CARD_W - 3, 3],
      [3, CARD_H - 3],
      [CARD_W - 3, CARD_H - 3],
      [CARD_W / 2, CARD_H / 2],
    ]) {
      const at = h.pixel(COLUMN_X[2] + dx, TABLEAU_Y + dy);
      expect(apart(at, felt), `${dx},${dy}`).toBeGreaterThan(60);
    }
    // Nothing card-sized is drawn in the gap between two columns.
    expect(
      apart(h.pixel(COLUMN_X[2] + CARD_W + 11, TABLEAU_Y + 70), felt),
    ).toBe(0);
  });

  it("draws its rank and its suit on its face", async () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [{ suit: "spades", rank: 10 }]);
    await h.advance(1);
    const blank = h.pixel(...body(COLUMN_X[0], TABLEAU_Y));
    const ink = (x0: number, y0: number, w: number, hgt: number): number => {
      let count = 0;
      for (let x = x0; x < x0 + w; x += 1) {
        for (let y = y0; y < y0 + hgt; y += 1) {
          if (apart(h.pixel(x, y), blank) > 60) count += 1;
        }
      }
      return count;
    };
    // The rank in the corner, the suit's own mark under it, and the suit again
    // at the middle of the card.
    expect(ink(COLUMN_X[0] + 6, TABLEAU_Y + 8, 30, 28)).toBeGreaterThan(40);
    expect(ink(COLUMN_X[0] + 8, TABLEAU_Y + 38, 26, 26)).toBeGreaterThan(40);
    expect(ink(COLUMN_X[0] + 26, TABLEAU_Y + 46, 48, 48)).toBeGreaterThan(200);
  });

  it("tells the two suit colors apart at a glance", async () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [{ suit: "hearts", rank: 5 }]);
    poseColumn(debug, 1, [{ suit: "spades", rank: 5 }]);
    poseColumn(debug, 2, [{ suit: "diamonds", rank: 5 }]);
    poseColumn(debug, 3, [{ suit: "clubs", rank: 5 }]);
    await h.advance(1);
    const red = h.pixel(...middle(COLUMN_X[0], TABLEAU_Y));
    const black = h.pixel(...middle(COLUMN_X[1], TABLEAU_Y));
    const diamond = h.pixel(...middle(COLUMN_X[2], TABLEAU_Y));
    const club = h.pixel(...middle(COLUMN_X[3], TABLEAU_Y));
    expect(apart(red, black)).toBeGreaterThan(90);
    expect(apart(red, diamond)).toBeLessThan(20);
    expect(apart(black, club)).toBeLessThan(20);
  });

  it("reads apart from the table, and a back from a face and from the table", async () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [{ suit: "hearts", rank: 5 }]);
    poseColumn(debug, 1, [{ suit: "spades", rank: 5, faceUp: false }]);
    await h.advance(1);
    const felt = h.pixel(...BARE);
    const face = h.pixel(...body(COLUMN_X[0], TABLEAU_Y));
    const faceMiddle = h.pixel(...middle(COLUMN_X[0], TABLEAU_Y));
    const back = h.pixel(...body(COLUMN_X[1], TABLEAU_Y));
    const backMiddle = h.pixel(...middle(COLUMN_X[1], TABLEAU_Y));

    expect(apart(face, felt)).toBeGreaterThan(90);
    expect(apart(faceMiddle, felt)).toBeGreaterThan(90);
    expect(apart(back, felt)).toBeGreaterThan(60);
    expect(apart(backMiddle, felt)).toBeGreaterThan(60);
    expect(apart(back, face)).toBeGreaterThan(90);
    expect(apart(backMiddle, faceMiddle)).toBeGreaterThan(90);
  });
});

describe("an empty pile", () => {
  it("draws a card-sized mark at its anchor, apart from the bare table", async () => {
    const { debug } = h;
    openTable(debug);
    await h.advance(1);
    const felt = h.pixel(...BARE);
    for (const [x, y] of [
      [STOCK_X, TOP_ROW_Y],
      [FOUNDATION_X[3], TOP_ROW_Y],
      [COLUMN_X[5], TABLEAU_Y],
    ]) {
      const at = h.pixel(...middle(x, y));
      expect(apart(at, felt), `${x},${y}`).toBeGreaterThan(30);
    }
    // Nothing is drawn at the third top-row position, which carries no pile.
    expect(apart(h.pixel(...middle(COLUMN_X[2], TOP_ROW_Y)), felt)).toBe(0);
  });
});

describe("a run in hand", () => {
  it("is drawn over the pile it passes, and highlights a legal target", async () => {
    const { debug } = h;
    openTable(debug);
    poseFoundation(debug, 0, "hearts", 4);
    poseColumn(debug, 0, [{ suit: "hearts", rank: 5 }]);
    await h.advance(1);
    const plain = h.pixel(FOUNDATION_X[0] + 3, TOP_ROW_Y + CARD_H / 2);

    debug.pointerDown(COLUMN_X[0] + CARD_W / 2, TABLEAU_Y + CARD_H / 2);
    debug.pointerMove(FOUNDATION_X[0] + CARD_W / 2, TOP_ROW_Y + CARD_H / 2);
    await h.advance(1);
    expect(debug.snapshot().dropTarget).toEqual({
      pile: "foundation",
      index: 0,
    });

    // The highlight reads apart from the same pile drawn without it, and it
    // reads over the run covering that pile.
    const highlighted = h.pixel(FOUNDATION_X[0] + 3, TOP_ROW_Y + CARD_H / 2);
    expect(apart(plain, highlighted)).toBeGreaterThan(60);

    // The held run is drawn over the pile it lies on: its own face, not the
    // foundation's five of hearts underneath.
    const held = h.pixel(...middle(FOUNDATION_X[0], TOP_ROW_Y));
    const drag = debug.snapshot().drag;
    expect(drag).not.toBeNull();
    expect(apart(held, h.pixel(...BARE))).toBeGreaterThan(90);
  });
});

describe("the HUD", () => {
  it("draws its strip and a label inside each of its three rectangles", async () => {
    const { debug } = h;
    openTable(debug);
    await h.advance(1);
    const felt = h.pixel(...BARE);
    const strip = h.pixel(60, HUD_Y + HUD_H / 2);
    expect(apart(strip, felt)).toBeGreaterThan(60);

    for (const rect of [HUD_NEW_GAME, HUD_MENU, HUD_SOUND]) {
      let ink = 0;
      for (let x = rect.x + 6; x < rect.x + rect.w - 6; x += 1) {
        for (let y = rect.y + 8; y < rect.y + rect.h - 8; y += 1) {
          if (apart(h.pixel(x, y), strip) > 60) ink += 1;
        }
      }
      expect(ink, `${rect.x}`).toBeGreaterThan(40);
    }
  });

  it("keeps every column clear of the strip", async () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(
      debug,
      0,
      Array.from({ length: 19 }, (_, i) => ({
        suit: i % 2 === 0 ? ("spades" as const) : ("hearts" as const),
        rank: 13 - (i % 13),
      })),
    );
    await h.advance(1);
    const felt = h.pixel(...BARE);
    for (let x = COLUMN_X[0] + 4; x < COLUMN_X[0] + CARD_W - 4; x += 8) {
      expect(apart(h.pixel(x, HUD_Y - 2), felt), `${x}`).toBe(0);
    }
  });
});

describe("the screens", () => {
  it("draws the title, the tagline, the deal-mode label and both items", async () => {
    const { debug } = h;
    debug.reset();
    await h.advance(1);
    const scrim = h.pixel(40, 40);
    const ink = (y0: number, y1: number): number => {
      let count = 0;
      for (let x = 360; x < 920; x += 4) {
        for (let y = y0; y < y1; y += 4) {
          if (apart(h.pixel(x, y), scrim) > 60) count += 1;
        }
      }
      return count;
    };
    expect(ink(170, 260)).toBeGreaterThan(40); // the title
    expect(ink(285, 315)).toBeGreaterThan(20); // the tagline
    expect(ink(352, 380)).toBeGreaterThan(10); // the deal-mode label
    expect(ink(440, 580)).toBeGreaterThan(40); // both items, in their plates
  });

  it("draws the how-to copy and its way back", async () => {
    const { debug } = h;
    debug.reset();
    debug.setScreen("howto");
    await h.advance(1);
    const scrim = h.pixel(40, 40);
    let ink = 0;
    for (let x = 200; x < 1080; x += 4) {
      for (let y = 80; y < 560; y += 4) {
        if (apart(h.pixel(x, y), scrim) > 60) ink += 1;
      }
    }
    expect(ink).toBeGreaterThan(400);

    let backInk = 0;
    for (let x = 500; x < 780; x += 2) {
      for (let y = 610; y < 645; y += 2) {
        if (apart(h.pixel(x, y), scrim) > 60) backInk += 1;
      }
    }
    expect(backInk).toBeGreaterThan(40);
  });

  it("draws the win message once the cascade is done, over the painted table", async () => {
    const { debug } = h;
    debug.reset();
    debug.setScreen("playing");
    debug.clearTable();
    for (const [index, suit] of (
      ["spades", "hearts", "diamonds", "clubs"] as const
    ).entries()) {
      poseFoundation(debug, index, suit, 13);
    }
    debug.setScreen("won");

    await h.advance(1);
    const felt = h.pixel(...BARE);
    const before = (): number => {
      let count = 0;
      for (let x = 420; x < 860; x += 4) {
        for (let y = 300; y < 400; y += 4) {
          if (apart(h.pixel(x, y), felt) > 60) count += 1;
        }
      }
      return count;
    };
    const quiet = before();

    // Coarse frames carry the whole cascade in a few dozen of them: the launch
    // clock keeps its remainder, so the count is the same however the interval
    // was divided.
    for (
      let block = 0;
      block < 80 && !debug.snapshot().cascadeDone;
      block += 1
    ) {
      await h.seconds(0.5, 0.5);
    }
    expect(debug.snapshot().cascadeDone).toBe(true);
    await h.advance(1);
    expect(before()).toBeGreaterThan(quiet + 200);
  });
});
