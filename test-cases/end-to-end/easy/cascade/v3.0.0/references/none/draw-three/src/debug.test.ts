// The debugging and automation surface, operation by operation.
//
// The rule every check below holds it to is the one specs/instrumentation.md
// states: every operation sets one field, reads the state, moves the clock, or is
// one of the game's own events, and `snapshot()` reports every field an operation
// can set — so every operation is verifiable by setting a value and reading it
// back.

import { createCanvas } from "@napi-rs/canvas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CASCADE_DEBUG_VERSION,
  DEAL_MODE,
  DEAL_MODE_LABEL,
  DECK_SIZE,
  FOUNDATION_X,
  LAUNCH_INTERVAL,
  LAUNCH_VX_MAX,
  LAUNCH_VX_MIN,
  STAGE_H,
  STAGE_W,
  TOP_ROW_Y,
  TURN_COUNT,
} from "./constants";
import {
  CASCADE_HANDLE,
  createDebugApi,
  installDebugApi,
  type CascadeDebugApi,
  type DebugHost,
} from "./debug";
import { game, type CascadeState } from "./game";
import { createRuntime, type Runtime } from "./runtime";
import { COLOR } from "./theme";
import type { Surface } from "./viewport";

let runtime: Runtime<CascadeState>;
let state: CascadeState;
let debug: CascadeDebugApi;

function stand(): void {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d");
  const element = Object.assign(canvas, {
    getContext: () => ctx,
  }) as unknown as HTMLCanvasElement;
  const events = new EventTarget();
  const surface: Surface = {
    cssWidth: () => STAGE_W,
    cssHeight: () => STAGE_H,
    origin: () => ({ x: 0, y: 0 }),
    dpr: () => 1,
    events: () => events,
  };
  runtime = createRuntime<CascadeState>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    menuBindings: {
      "menu-up": ["ArrowUp"],
      "menu-down": ["ArrowDown"],
      "menu-confirm": ["Enter"],
      "menu-back": ["Escape"],
    },
    background: COLOR.table,
    surface,
    audioContext: () => null,
  });
  state = runtime.initialize();
  debug = createDebugApi(state, runtime);
}

beforeEach(() => {
  stand();
  debug.setAutoStep(false);
  debug.reset();
});

afterEach(() => {
  runtime.destroy();
});

describe("the surface itself", () => {
  it("reports its version", () => {
    expect(debug.version).toBe(CASCADE_DEBUG_VERSION);
    expect(debug.snapshot().version).toBe(CASCADE_DEBUG_VERSION);
  });

  it("installs on the handle and takes itself off again", () => {
    const remove = installDebugApi(state, runtime as unknown as DebugHost);
    const target = globalThis as unknown as Record<string, unknown>;
    expect(target[CASCADE_HANDLE]).toBeDefined();
    remove();
    expect(target[CASCADE_HANDLE]).toBeUndefined();
  });

  it("reports this build's deal mode", () => {
    const shot = debug.snapshot();
    expect(shot.dealMode).toBe(DEAL_MODE);
    expect(shot.turnCount).toBe(TURN_COUNT);
    expect(shot.dealModeLabel).toBe(DEAL_MODE_LABEL);
  });
});

describe("reset", () => {
  it("puts every declared field back to its title-screen value", () => {
    debug.setScreen("playing");
    debug.addCard("tableau", 0, "spades", 5, true);
    debug.addWasteSet(2);
    debug.addFlyer("hearts", 3, 10, 10, 5, 5);
    debug.setLaunchClock(0.4);
    debug.setAutoFlip(false);
    debug.setWinDetect(false);
    debug.setLaunching(false);
    debug.setTrailPainting(false);
    debug.pointerDown(100, 100);
    runtime.advance(0.5);

    debug.reset();
    const shot = debug.snapshot();
    expect(shot.screen).toBe("title");
    expect(shot.tableau.every((column) => column.length === 0)).toBe(true);
    expect(shot.stock).toEqual([]);
    expect(shot.waste).toEqual([]);
    expect(shot.wasteSets).toEqual([]);
    expect(shot.foundations.every((pile) => pile.length === 0)).toBe(true);
    expect(shot.drag).toBeNull();
    expect(shot.dropTarget).toBeNull();
    expect(shot.pointer).toEqual({ x: 0, y: 0, down: false });
    expect(shot.lastPress).toBeNull();
    expect(shot.autoFlip).toBe(true);
    expect(shot.winDetect).toBe(true);
    expect(shot.launching).toBe(true);
    expect(shot.trailPainting).toBe(true);
    expect(shot.launchClock).toBe(0);
    expect(shot.launched).toBe(0);
    expect(shot.flyers).toEqual([]);
    expect(shot.cascadeDone).toBe(false);
    expect(shot.trailStamps).toBe(0);
    expect(shot.simTime).toBe(0);
  });

  it("deals a full stock afresh on every deal", () => {
    debug.reset();
    debug.deal();
    const first = debug
      .snapshot()
      .stock.map((card) => `${card.suit}${card.rank}`);
    expect(first).toHaveLength(24);
    debug.reset();
    debug.deal();
    expect(
      debug.snapshot().stock.map((card) => `${card.suit}${card.rank}`),
    ).not.toEqual(first);
  });

  it("leaves the mute bit exactly as it stands", () => {
    state.muted = true;
    debug.reset();
    expect(debug.snapshot().muted).toBe(true);
  });
});

describe("the clock", () => {
  it("advances whole frames of an exact length", () => {
    debug.advance(1, 4);
    expect(debug.snapshot().simTime).toBeCloseTo(1, 9);
    expect(runtime.frame().count).toBe(4);
  });

  it("advances one frame when it is given no count", () => {
    debug.advance(0.25);
    expect(runtime.frame().count).toBe(1);
  });

  it("takes the game off real time and gives it back", () => {
    debug.setAutoStep(true);
    expect(runtime.autoStep()).toBe(true);
    debug.setAutoStep(false);
    expect(runtime.autoStep()).toBe(false);
  });
});

describe("the screen", () => {
  it("poses a screen and leaves the table as it stands", () => {
    debug.addCard("tableau", 2, "spades", 5, true);
    debug.setScreen("won");
    const shot = debug.snapshot();
    expect(shot.screen).toBe("won");
    expect(shot.tableau[2]).toHaveLength(1);
  });
});

describe("the cards", () => {
  it("adds one card to the top of the pile it names", () => {
    debug.addCard("tableau", 4, "diamonds", 12, true);
    debug.addCard("tableau", 4, "clubs", 11, false);
    const column = debug.snapshot().tableau[4];
    expect(column).toHaveLength(2);
    expect(column[1]).toMatchObject({
      suit: "clubs",
      rank: 11,
      color: "black",
      faceUp: false,
    });
    expect(column[0].color).toBe("red");
  });

  it("hands every card a distinct id the caller reads off the snapshot", () => {
    debug.addCard("waste", 0, "spades", 1, true);
    debug.addCard("waste", 0, "spades", 2, true);
    const waste = debug.snapshot().waste;
    expect(waste[0].id).not.toBe(waste[1].id);
  });

  it("touches no other pile and no other field, the set memory included", () => {
    debug.addCard("waste", 0, "spades", 1, true);
    const shot = debug.snapshot();
    expect(shot.wasteSets).toEqual([]);
    expect(shot.wasteVisibleCount).toBe(0);
    expect(shot.stock).toEqual([]);
  });

  it("refuses a pile, a suit or a rank that does not exist", () => {
    expect(() => debug.addCard("tableau", 9, "spades", 1, true)).toThrow(
      RangeError,
    );
    expect(() =>
      debug.addCard("tableau", 0, "swords" as "spades", 1, true),
    ).toThrow(RangeError);
    expect(() => debug.addCard("tableau", 0, "spades", 14, true)).toThrow(
      RangeError,
    );
  });

  it("removes one card by id, leaving the rest of its pile in order", () => {
    for (const rank of [3, 4, 5])
      debug.addCard("tableau", 0, "spades", rank, true);
    const middle = debug.snapshot().tableau[0][1].id;
    debug.removeCard(middle);
    expect(debug.snapshot().tableau[0].map((card) => card.rank)).toEqual([
      3, 5,
    ]);
    expect(() => debug.removeCard(9999)).not.toThrow();
  });

  it("takes a removed waste card off the newest set that holds any", () => {
    for (const rank of [3, 4, 5])
      debug.addCard("waste", 0, "spades", rank, true);
    debug.addWasteSet(3);
    debug.removeCard(debug.snapshot().waste[2].id);
    expect(debug.snapshot().wasteSets).toEqual([2]);
  });

  it("sets one card's face", () => {
    debug.addCard("tableau", 1, "hearts", 6, false);
    const id = debug.snapshot().tableau[1][0].id;
    debug.setCardFaceUp(id, true);
    expect(debug.snapshot().tableau[1][0].faceUp).toBe(true);
    debug.setCardFaceUp(id, false);
    expect(debug.snapshot().tableau[1][0].faceUp).toBe(false);
  });

  it("clears one pile and leaves the other twelve standing", () => {
    debug.addCard("tableau", 0, "spades", 5, true);
    debug.addCard("tableau", 1, "hearts", 5, true);
    debug.clearPile("tableau", 0);
    const shot = debug.snapshot();
    expect(shot.tableau[0]).toEqual([]);
    expect(shot.tableau[1]).toHaveLength(1);
  });

  it("empties the waste's set memory when it clears the waste", () => {
    debug.addCard("waste", 0, "spades", 5, true);
    debug.addWasteSet(1);
    debug.clearPile("waste", 0);
    expect(debug.snapshot().wasteSets).toEqual([]);
  });

  it("clears all thirteen piles and leaves the flyers and gates alone", () => {
    debug.deal();
    debug.addWasteSet(2);
    debug.addFlyer("hearts", 5, 10, 10, 0, 0);
    debug.setAutoFlip(false);
    debug.clearTable();
    const shot = debug.snapshot();
    expect(shot.stock).toEqual([]);
    expect(shot.tableau.every((column) => column.length === 0)).toBe(true);
    expect(shot.wasteSets).toEqual([]);
    expect(shot.flyers).toHaveLength(1);
    expect(shot.autoFlip).toBe(false);
  });
});

describe("the waste's sets", () => {
  it("poses a set and reads it back", () => {
    debug.addWasteSet(3);
    debug.addWasteSet(2);
    const shot = debug.snapshot();
    expect(shot.wasteSets).toEqual([3, 2]);
    expect(shot.wasteVisibleCount).toBe(2);
  });

  it("empties the memory, leaving the cards standing", () => {
    for (const rank of [3, 4, 5])
      debug.addCard("waste", 0, "spades", rank, true);
    debug.addWasteSet(3);
    debug.clearWasteSets();
    const shot = debug.snapshot();
    expect(shot.wasteSets).toEqual([]);
    expect(shot.wasteVisibleCount).toBe(0);
    expect(shot.waste).toHaveLength(3);
  });

  it("offers nothing to play from a waste showing no card", () => {
    for (const rank of [3, 4, 5])
      debug.addCard("waste", 0, "hearts", rank, true);
    debug.addCard("tableau", 0, "spades", 6, true);
    expect(debug.move("waste", 0, 2, "tableau", 0)).toBe(false);
    expect(debug.autoMove("waste", 0)).toBe(false);
  });
});

describe("the game's own events", () => {
  it("deals a whole board and leaves the screen alone", () => {
    debug.setScreen("howto");
    debug.deal();
    const shot = debug.snapshot();
    expect(shot.screen).toBe("howto");
    expect(shot.stock).toHaveLength(24);
    const total =
      shot.stock.length +
      shot.waste.length +
      shot.foundations.reduce((n, pile) => n + pile.length, 0) +
      shot.tableau.reduce((n, pile) => n + pile.length, 0);
    expect(total).toBe(DECK_SIZE);
  });

  it("turns the deal mode's count of cards", () => {
    debug.deal();
    debug.turnStock();
    const shot = debug.snapshot();
    expect(shot.waste).toHaveLength(TURN_COUNT);
    expect(shot.wasteVisibleCount).toBe(TURN_COUNT);
  });

  it("reports what the rules decided about a move", () => {
    debug.addCard("tableau", 0, "spades", 13, true);
    expect(debug.move("tableau", 0, 0, "tableau", 1)).toBe(true);
    expect(debug.move("tableau", 1, 0, "tableau", 2)).toBe(true);
    expect(debug.move("tableau", 2, 0, "foundation", 0)).toBe(false);
    expect(debug.snapshot().tableau[2]).toHaveLength(1);
  });

  it("reports what the rules decided about an auto-move", () => {
    debug.addCard("tableau", 0, "clubs", 1, true);
    expect(debug.autoMove("tableau", 0)).toBe(true);
    expect(debug.autoMove("tableau", 0)).toBe(false);
    expect(debug.snapshot().foundations[0]).toHaveLength(1);
  });

  it("keeps a card's id across a move, a turn and a flip", () => {
    debug.addCard("stock", 0, "hearts", 1, false);
    const id = debug.snapshot().stock[0].id;
    debug.turnStock();
    expect(debug.snapshot().waste[0].id).toBe(id);
    expect(debug.autoMove("waste", 0)).toBe(true);
    expect(debug.snapshot().foundations[0][0].id).toBe(id);
  });
});

describe("the state the waste's set memory is about", () => {
  it("shows two cards on a waste of five once a set is played off entirely", () => {
    // Driven through the build's own stock rather than a posed waste: three
    // turns, one card played home off the second set, then the whole third set
    // played off. Two is the rule, one would be the last turn's counter, three
    // would be a fan refilled from the cards buried beneath it.
    debug.setScreen("playing");
    debug.clearTable();
    // Bottom to top. The turns take three at a time off the top, so the four
    // Aces are placed where the tops of the second and third sets fall.
    for (const [suit, rank] of [
      ["hearts", 1],
      ["diamonds", 1],
      ["clubs", 1],
      ["spades", 1],
      ["hearts", 7],
      ["hearts", 8],
      ["hearts", 9],
      ["spades", 7],
      ["spades", 8],
    ] as const) {
      debug.addCard("stock", 0, suit, rank, false);
    }

    debug.turnStock();
    debug.turnStock();
    expect(debug.snapshot().wasteSets).toEqual([3, 3]);

    // One card off the newest set.
    expect(debug.autoMove("waste", 0)).toBe(true);
    expect(debug.snapshot().wasteSets).toEqual([3, 2]);

    debug.turnStock();
    expect(debug.snapshot().wasteSets).toEqual([3, 2, 3]);
    expect(debug.snapshot().waste).toHaveLength(8);

    // The whole newest set, played off.
    for (let i = 0; i < 3; i += 1) {
      expect(debug.autoMove("waste", 0)).toBe(true);
    }

    const shot = debug.snapshot();
    expect(shot.waste).toHaveLength(5);
    expect(shot.wasteSets).toEqual([3, 2]);
    expect(shot.wasteVisibleCount).toBe(2);
    expect(shot.waste[4]).toMatchObject({ suit: "hearts", rank: 7 });
    expect(shot.foundations.map((pile) => pile.length)).toEqual([1, 1, 1, 1]);
  });
});

describe("the pointer operations", () => {
  it("feeds the same path a real pointer feeds", () => {
    debug.setScreen("playing");
    debug.clearTable();
    debug.addCard("tableau", 0, "spades", 13, true);
    debug.pointerDown(234, 190);
    const held = debug.snapshot();
    expect(held.drag?.cards).toHaveLength(1);
    expect(held.pointer).toEqual({ x: 234, y: 190, down: true });
    debug.pointerMove(356, 190);
    debug.pointerUp(356, 190);
    const shot = debug.snapshot();
    expect(shot.drag).toBeNull();
    expect(shot.tableau[1]).toHaveLength(1);
    expect(shot.pointer.down).toBe(false);
  });

  it("resolves before the call returns, with no frame in between", () => {
    debug.setScreen("playing");
    debug.clearTable();
    debug.addCard("tableau", 0, "hearts", 1, true);
    debug.pointerDown(234, 190);
    debug.pointerUp(234, 190);
    debug.pointerDown(234, 190);
    expect(runtime.frame().count).toBe(0);
    expect(debug.snapshot().foundations[0]).toHaveLength(1);
  });

  it("refuses a point that is not a number", () => {
    expect(() => debug.pointerDown(Number.NaN, 0)).toThrow(RangeError);
  });
});

describe("the faculty gates", () => {
  it("reports each one and restores it on reset", () => {
    for (const [set, read] of [
      [debug.setAutoFlip, "autoFlip"],
      [debug.setWinDetect, "winDetect"],
      [debug.setLaunching, "launching"],
      [debug.setTrailPainting, "trailPainting"],
    ] as const) {
      set(false);
      expect(debug.snapshot()[read]).toBe(false);
      set(true);
      expect(debug.snapshot()[read]).toBe(true);
    }
  });
});

describe("the cascade operations", () => {
  it("adds a flyer at a position and a velocity, and reads it back", () => {
    debug.addFlyer("diamonds", 9, 120, 240, 300, -120);
    const flyer = debug.snapshot().flyers[0];
    expect(flyer).toMatchObject({
      suit: "diamonds",
      rank: 9,
      x: 120,
      y: 240,
      vx: 300,
      vy: -120,
    });
  });

  it("poses one flyer's position and velocity", () => {
    debug.addFlyer("diamonds", 9, 0, 0, 0, 0);
    const id = debug.snapshot().flyers[0].id;
    debug.setFlyerPosition(id, 400, 100);
    debug.setFlyerVelocity(id, -60, 20);
    expect(debug.snapshot().flyers[0]).toMatchObject({
      x: 400,
      y: 100,
      vx: -60,
      vy: 20,
    });
  });

  it("removes one flyer by id, and all of them at once", () => {
    debug.addFlyer("diamonds", 9, 0, 0, 0, 0);
    debug.addFlyer("clubs", 4, 0, 0, 0, 0);
    debug.removeFlyer(debug.snapshot().flyers[0].id);
    expect(debug.snapshot().flyers).toHaveLength(1);
    debug.clearFlyers();
    expect(debug.snapshot().flyers).toEqual([]);
  });

  it("sets the launch clock and reads it back", () => {
    debug.setLaunchClock(0.12);
    expect(debug.snapshot().launchClock).toBeCloseTo(0.12, 9);
  });

  it("draws a launch vx in range and changes nothing", () => {
    debug.setScreen("won");
    debug.addCard("foundation", 0, "spades", 13, true);
    const before = debug.snapshot();
    for (let draw = 0; draw < 32; draw += 1) {
      const vx = debug.drawLaunchVx();
      expect(Math.abs(vx)).toBeGreaterThanOrEqual(LAUNCH_VX_MIN);
      expect(Math.abs(vx)).toBeLessThanOrEqual(LAUNCH_VX_MAX);
    }
    expect(debug.snapshot()).toEqual(before);
  });

  it("clears the painted layer and its count, leaving the flyers standing", () => {
    debug.addFlyer("clubs", 4, 200, 200, 0, 0);
    runtime.advance(1 / 60);
    expect(debug.snapshot().trailStamps).toBe(1);
    debug.clearTrail();
    expect(debug.snapshot().trailStamps).toBe(0);
    expect(debug.snapshot().flyers).toHaveLength(1);
  });

  it("refuses a flyer with no suit, no rank or no position", () => {
    expect(() => debug.addFlyer("swords" as "spades", 4, 0, 0, 0, 0)).toThrow(
      RangeError,
    );
    expect(() => debug.addFlyer("clubs", 0, 0, 0, 0, 0)).toThrow(RangeError);
    expect(() => debug.addFlyer("clubs", 4, Number.NaN, 0, 0, 0)).toThrow(
      RangeError,
    );
  });

  it("counts launched cards up rather than deriving them from the foundations", () => {
    debug.clearTable();
    debug.addFlyer("clubs", 4, 200, 200, 0, 0);
    runtime.advance(1 / 60);
    expect(debug.snapshot().launched).toBe(0);
    expect(debug.snapshot().cascadeDone).toBe(false);
  });

  it("begins the cascade on the win, with the clock owed its first launch", () => {
    debug.setScreen("playing");
    debug.clearTable();
    for (const [slot, suit] of [
      [0, "spades"],
      [1, "hearts"],
      [2, "diamonds"],
      [3, "clubs"],
    ] as const) {
      for (let rank = 1; rank <= 13; rank += 1) {
        if (slot === 3 && rank === 13) continue;
        debug.addCard("foundation", slot, suit, rank, true);
      }
    }
    debug.addCard("tableau", 0, "clubs", 13, true);
    expect(debug.move("tableau", 0, 0, "foundation", 3)).toBe(true);
    expect(debug.snapshot().screen).toBe("won");
    expect(debug.snapshot().launchClock).toBeCloseTo(LAUNCH_INTERVAL, 9);

    runtime.advance(1 / 240);
    const flyer = debug.snapshot().flyers[0];
    expect(flyer.x).toBe(FOUNDATION_X[0]);
    expect(flyer.y).toBe(TOP_ROW_Y);
    expect(debug.snapshot().launched).toBe(1);
  });
});
