// The pointer: what a press lifts, how a held run follows and highlights, what
// separates a click from a drop, the double click, and the controls
// (specs/controls.md, specs/screens.md).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CARD_H,
  CARD_W,
  COLUMN_X,
  DOUBLE_CLICK_SLOP,
  DOUBLE_CLICK_WINDOW,
  DRAG_THRESHOLD,
  FOUNDATION_X,
  STOCK_X,
  TABLEAU_Y,
  TOP_ROW_Y,
  WASTE_X,
} from "./constants";
import {
  HOWTO_BACK,
  HUD_MENU,
  HUD_NEW_GAME,
  HUD_SOUND,
  TITLE_HOW_TO,
  TITLE_NEW_GAME,
} from "./menus";
import {
  createHarness,
  openTable,
  poseColumn,
  poseFoundation,
  poseNearlyWon,
  poseStock,
  poseWaste,
  type Harness,
} from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** The top edge of the card at `row` of column `col`, at the offsets it draws at. */
function columnCardY(h: Harness, col: number, row: number): number {
  const column = h.state.tableau[col];
  let y = TABLEAU_Y;
  for (let i = 1; i <= row; i += 1) y += column[i - 1].faceUp ? 34 : 24;
  return y;
}

/**
 * A point that resolves to the card at `row` of column `col`.
 *
 * A press resolves to the LOWEST card whose footprint contains it, so a card
 * with another card fanned below it is pressed on the sliver above that one
 * rather than at its own center.
 */
function columnCardCenter(
  h: Harness,
  col: number,
  row: number,
): [number, number] {
  const column = h.state.tableau[col];
  const y = columnCardY(h, col, row);
  const covered = row < column.length - 1;
  return [
    COLUMN_X[col] + CARD_W / 2,
    covered ? y + (columnCardY(h, col, row + 1) - y) / 2 : y + CARD_H / 2,
  ];
}

const STOCK_CENTER: [number, number] = [
  STOCK_X + CARD_W / 2,
  TOP_ROW_Y + CARD_H / 2,
];
const WASTE_CENTER: [number, number] = [
  WASTE_X + CARD_W / 2,
  TOP_ROW_Y + CARD_H / 2,
];
const EMPTY_COLUMN_CENTER = (col: number): [number, number] => [
  COLUMN_X[col] + CARD_W / 2,
  TABLEAU_Y + CARD_H / 2,
];
const FOUNDATION_CENTER = (index: number): [number, number] => [
  FOUNDATION_X[index] + CARD_W / 2,
  TOP_ROW_Y + CARD_H / 2,
];

/** Press, glide and release, through the surface's own pointer operations. */
function drag(
  h: Harness,
  from: [number, number],
  to: [number, number],
  steps = 4,
): void {
  const { debug } = h;
  debug.pointerDown(from[0], from[1]);
  for (let i = 1; i <= steps; i += 1) {
    debug.pointerMove(
      from[0] + ((to[0] - from[0]) * i) / steps,
      from[1] + ((to[1] - from[1]) * i) / steps,
    );
  }
  debug.pointerUp(to[0], to[1]);
}

/** Press and release at one point, which is a click rather than a drop. */
function clickAt(h: Harness, x: number, y: number): void {
  h.debug.pointerDown(x, y);
  h.debug.pointerUp(x, y);
}

describe("what a press lifts", () => {
  it("takes a column card and every card below it, on the press itself", () => {
    const { debug } = h;
    openTable(debug);
    const ids = poseColumn(debug, 0, [
      { suit: "clubs", rank: 13 },
      { suit: "hearts", rank: 12 },
      { suit: "spades", rank: 11 },
    ]);
    debug.pointerDown(...columnCardCenter(h, 0, 1));
    const shot = debug.snapshot();
    expect(shot.drag).not.toBeNull();
    expect(shot.drag?.cards.map((card) => card.id)).toEqual([ids[1], ids[2]]);
    expect(shot.drag?.fromPile).toBe("tableau");
    expect(shot.drag?.fromIndex).toBe(0);
    // The run has left the pile it was lifted from for the length of the gesture.
    expect(shot.tableau[0].map((card) => card.id)).toEqual([ids[0]]);
  });

  it("takes the waste's top card alone, and a foundation's top card alone", () => {
    const { debug } = h;
    openTable(debug);
    poseWaste(
      debug,
      [
        { suit: "clubs", rank: 4 },
        { suit: "hearts", rank: 9 },
      ],
      [1, 1],
    );
    debug.pointerDown(...WASTE_CENTER);
    expect(debug.snapshot().drag?.cards).toHaveLength(1);
    debug.pointerUp(...WASTE_CENTER);

    poseFoundation(debug, 1, "spades", 3);
    debug.pointerDown(...FOUNDATION_CENTER(1));
    expect(debug.snapshot().drag?.cards).toHaveLength(1);
    expect(debug.snapshot().drag?.fromPile).toBe("foundation");
  });

  it("lifts nothing from a face-down card, the bare table or the stock", () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [{ suit: "clubs", rank: 9, faceUp: false }]);
    poseStock(debug, [{ suit: "hearts", rank: 2 }]);

    debug.pointerDown(...columnCardCenter(h, 0, 0));
    expect(debug.snapshot().drag).toBeNull();
    debug.pointerUp(...columnCardCenter(h, 0, 0));

    debug.pointerDown(...EMPTY_COLUMN_CENTER(5));
    expect(debug.snapshot().drag).toBeNull();
    debug.pointerUp(...EMPTY_COLUMN_CENTER(5));

    debug.pointerDown(...STOCK_CENTER);
    expect(debug.snapshot().drag).toBeNull();
  });

  it("lifts nothing off a waste whose set memory is empty", () => {
    const { debug } = h;
    openTable(debug);
    poseWaste(debug, [{ suit: "clubs", rank: 4 }], [1]);
    debug.clearWasteSets();
    debug.pointerDown(...WASTE_CENTER);
    expect(debug.snapshot().drag).toBeNull();
  });
});

describe("a held run", () => {
  it("follows the pointer and highlights a legal target under it", () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [{ suit: "hearts", rank: 1 }]);
    const from = columnCardCenter(h, 0, 0);
    debug.pointerDown(...from);
    expect(debug.snapshot().dropTarget).toBeNull();

    debug.pointerMove(from[0] + 40, from[1] - 20);
    expect(debug.snapshot().drag?.x).toBeCloseTo(COLUMN_X[0] + 40, 6);
    expect(debug.snapshot().drag?.y).toBeCloseTo(TABLEAU_Y - 20, 6);

    debug.pointerMove(...FOUNDATION_CENTER(2));
    expect(debug.snapshot().dropTarget).toEqual({
      pile: "foundation",
      index: 2,
    });
  });

  it("reports no target over a pile that would refuse it", () => {
    const { debug } = h;
    openTable(debug);
    poseFoundation(debug, 0, "spades", 5);
    poseColumn(debug, 0, [{ suit: "hearts", rank: 9 }]);
    drag(h, columnCardCenter(h, 0, 0), FOUNDATION_CENTER(0), 2);
    // The gesture is over, so nothing is held and nothing is highlighted.
    expect(debug.snapshot().dropTarget).toBeNull();

    poseColumn(debug, 1, [{ suit: "hearts", rank: 9 }]);
    debug.pointerDown(...columnCardCenter(h, 1, 0));
    debug.pointerMove(...FOUNDATION_CENTER(0));
    expect(debug.snapshot().dropTarget).toBeNull();
  });
});

describe("a release", () => {
  it("completes the move over a legal target", () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [{ suit: "hearts", rank: 1 }]);
    drag(h, columnCardCenter(h, 0, 0), FOUNDATION_CENTER(0));
    const shot = debug.snapshot();
    expect(shot.foundations[0]).toHaveLength(1);
    expect(shot.tableau[0]).toHaveLength(0);
    expect(shot.drag).toBeNull();
  });

  it("returns the run over an illegal pile and away from every pile", () => {
    const { debug } = h;
    openTable(debug);
    poseFoundation(debug, 0, "spades", 5);
    const ids = poseColumn(debug, 0, [
      { suit: "spades", rank: 8 },
      { suit: "hearts", rank: 7 },
    ]);

    drag(h, columnCardCenter(h, 0, 0), FOUNDATION_CENTER(0));
    expect(debug.snapshot().tableau[0].map((card) => card.id)).toEqual(ids);

    // The gap between two columns lies on no pile at all.
    drag(h, columnCardCenter(h, 0, 0), [COLUMN_X[1] - 11, TABLEAU_Y + 400]);
    expect(debug.snapshot().tableau[0].map((card) => card.id)).toEqual(ids);
  });

  it("resolves to the pile the leading card's center lies in", () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [{ suit: "spades", rank: 13 }]);
    // A point whose card overlaps two columns but whose center is in one.
    const centre = EMPTY_COLUMN_CENTER(3);
    drag(h, columnCardCenter(h, 0, 0), [centre[0] - 40, centre[1]]);
    expect(debug.snapshot().tableau[3]).toHaveLength(1);
    expect(debug.snapshot().tableau[2]).toHaveLength(0);
  });

  it("leaves an empty column empty when it refuses the run", () => {
    const { debug } = h;
    openTable(debug);
    const ids = poseColumn(debug, 0, [{ suit: "spades", rank: 12 }]);
    drag(h, columnCardCenter(h, 0, 0), EMPTY_COLUMN_CENTER(4));
    expect(debug.snapshot().tableau[4]).toHaveLength(0);
    expect(debug.snapshot().tableau[0].map((card) => card.id)).toEqual(ids);
  });

  it("with nothing in hand and nothing under the press changes nothing", () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 2, [{ suit: "spades", rank: 4 }]);
    const before = JSON.stringify(debug.snapshot().tableau);
    debug.pointerUp(700, 400);
    expect(JSON.stringify(debug.snapshot().tableau)).toBe(before);
    expect(debug.snapshot().drag).toBeNull();
  });

  it("does not turn the card beneath a lifted one", () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [
      { suit: "clubs", rank: 9, faceUp: false },
      { suit: "hearts", rank: 4 },
    ]);
    const from = columnCardCenter(h, 0, 1);
    debug.pointerDown(...from);
    expect(debug.snapshot().tableau[0][0].faceUp).toBe(false);
    debug.pointerMove(700, 500);
    expect(debug.snapshot().tableau[0][0].faceUp).toBe(false);
    debug.pointerUp(700, 500);
    expect(debug.snapshot().tableau[0][0].faceUp).toBe(false);
  });
});

describe("a click against a drop", () => {
  it("turns the stock inside the threshold and not outside it", () => {
    const { debug } = h;
    openTable(debug);
    poseStock(debug, [
      { suit: "spades", rank: 2 },
      { suit: "hearts", rank: 3 },
    ]);

    debug.pointerDown(...STOCK_CENTER);
    debug.pointerUp(STOCK_CENTER[0] + DRAG_THRESHOLD - 1, STOCK_CENTER[1]);
    expect(debug.snapshot().waste).toHaveLength(1);

    debug.pointerDown(...STOCK_CENTER);
    debug.pointerUp(STOCK_CENTER[0] + DRAG_THRESHOLD + 1, STOCK_CENTER[1]);
    expect(debug.snapshot().waste).toHaveLength(1);
  });

  it("returns a held run rather than dropping it", () => {
    const { debug } = h;
    openTable(debug);
    const ids = poseColumn(debug, 0, [{ suit: "hearts", rank: 1 }]);
    const from = columnCardCenter(h, 0, 0);
    debug.pointerDown(...from);
    debug.pointerUp(from[0] + 3, from[1] + 3);
    expect(debug.snapshot().tableau[0].map((card) => card.id)).toEqual(ids);
    expect(debug.snapshot().foundations.flat()).toHaveLength(0);
  });

  it("recycles the empty stock slot", () => {
    const { debug } = h;
    openTable(debug);
    poseWaste(
      debug,
      [
        { suit: "spades", rank: 2 },
        { suit: "hearts", rank: 3 },
      ],
      [1, 1],
    );
    clickAt(h, ...STOCK_CENTER);
    const shot = debug.snapshot();
    expect(shot.stock).toHaveLength(2);
    expect(shot.waste).toHaveLength(0);
    expect(shot.wasteSets).toEqual([]);
  });
});

describe("the double click", () => {
  it("sends a card home on a second press inside the window and the slop", () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [{ suit: "hearts", rank: 1 }]);
    const at = columnCardCenter(h, 0, 0);
    clickAt(h, ...at);
    clickAt(h, ...at);
    expect(debug.snapshot().foundations.flat()).toHaveLength(1);
    expect(debug.snapshot().tableau[0]).toHaveLength(0);
  });

  it("does nothing when the second press is too slow", async () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [{ suit: "hearts", rank: 1 }]);
    const at = columnCardCenter(h, 0, 0);
    clickAt(h, ...at);
    await h.seconds(DOUBLE_CLICK_WINDOW + 0.1);
    clickAt(h, ...at);
    expect(debug.snapshot().foundations.flat()).toHaveLength(0);
    expect(debug.snapshot().tableau[0]).toHaveLength(1);
  });

  it("does nothing when the second press is too far away", () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [{ suit: "hearts", rank: 1 }]);
    const at = columnCardCenter(h, 0, 0);
    clickAt(h, at[0] - DOUBLE_CLICK_SLOP - 20, at[1]);
    clickAt(h, ...at);
    expect(debug.snapshot().foundations.flat()).toHaveLength(0);
  });

  it("does nothing on the bare table", () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 1, [{ suit: "hearts", rank: 1 }]);
    const before = JSON.stringify(debug.snapshot().tableau);
    clickAt(h, 700, 500);
    clickAt(h, 700, 500);
    expect(JSON.stringify(debug.snapshot().tableau)).toBe(before);
  });

  it("sends the waste's top card home", () => {
    const { debug } = h;
    openTable(debug);
    poseWaste(debug, [{ suit: "clubs", rank: 1 }], [1]);
    clickAt(h, ...WASTE_CENTER);
    clickAt(h, ...WASTE_CENTER);
    expect(debug.snapshot().foundations.flat()).toHaveLength(1);
    expect(debug.snapshot().waste).toHaveLength(0);
  });
});

describe("the controls", () => {
  it("deals and enters play from the title, and opens the how-to screen", () => {
    const { debug } = h;
    debug.reset();
    clickAt(h, TITLE_NEW_GAME.x + 10, TITLE_NEW_GAME.y + 10);
    let shot = debug.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.tableau.flat().concat(shot.stock)).toHaveLength(52);

    debug.reset();
    clickAt(h, TITLE_HOW_TO.x + 10, TITLE_HOW_TO.y + 10);
    expect(debug.snapshot().screen).toBe("howto");
    clickAt(h, HOWTO_BACK.x + 10, HOWTO_BACK.y + 10);
    shot = debug.snapshot();
    expect(shot.screen).toBe("title");
  });

  it("deals, returns to the title and toggles mute from the HUD", () => {
    const { debug } = h;
    debug.reset();
    debug.deal();
    debug.setScreen("playing");
    const before = JSON.stringify(debug.snapshot().tableau);
    clickAt(h, HUD_NEW_GAME.x + 10, HUD_NEW_GAME.y + 10);
    expect(debug.snapshot().screen).toBe("playing");
    expect(JSON.stringify(debug.snapshot().tableau)).not.toBe(before);

    expect(debug.snapshot().muted).toBe(false);
    clickAt(h, HUD_SOUND.x + 10, HUD_SOUND.y + 10);
    expect(debug.snapshot().muted).toBe(true);
    clickAt(h, HUD_SOUND.x + 10, HUD_SOUND.y + 10);
    expect(debug.snapshot().muted).toBe(false);

    clickAt(h, HUD_MENU.x + 10, HUD_MENU.y + 10);
    expect(debug.snapshot().screen).toBe("title");
  });

  it("deals a fresh game on a press over the won screen", async () => {
    const { debug } = h;
    openTable(debug);
    poseNearlyWon(debug);
    debug.move("tableau", 0, 0, "foundation", 3);
    await h.seconds(0.5, 1 / 240);
    expect(debug.snapshot().trailStamps).toBeGreaterThan(0);

    debug.pointerDown(...STOCK_CENTER);
    debug.pointerUp(...STOCK_CENTER);
    const shot = debug.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.trailStamps).toBe(0);
    expect(shot.stock.concat(shot.tableau.flat())).toHaveLength(52);
    expect(shot.flyers).toHaveLength(0);
  });
});

describe("the engine's own pointer", () => {
  it("answers every sample a frame delivered, in the order it arrived", async () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [{ suit: "hearts", rank: 1 }]);
    const from = columnCardCenter(h, 0, 0);
    const to = FOUNDATION_CENTER(0);

    // A whole gesture inside one frame: a build that folded only the frame's
    // last sample would see the release alone and lift nothing.
    h.pointer("pointerdown", from[0], from[1]);
    h.pointer("pointermove", (from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
    h.pointer("pointerup", to[0], to[1]);
    await h.advance(1);

    const shot = debug.snapshot();
    expect(shot.foundations[0]).toHaveLength(1);
    expect(shot.tableau[0]).toHaveLength(0);
    expect(shot.pointer).toEqual({ x: to[0], y: to[1], down: false });
  });

  it("carries a press through the engine as the surface's own does", async () => {
    const { debug } = h;
    openTable(debug);
    poseStock(debug, [{ suit: "spades", rank: 2 }]);
    h.pointer("pointerdown", ...STOCK_CENTER);
    h.pointer("pointerup", ...STOCK_CENTER);
    await h.advance(1);
    expect(debug.snapshot().waste).toHaveLength(1);
  });
});
