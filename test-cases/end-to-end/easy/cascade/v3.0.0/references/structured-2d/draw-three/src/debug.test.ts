import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CARD_W,
  CASCADE_DEBUG_VERSION,
  COLUMN_X,
  DEAL_MODE,
  DEAL_MODE_LABEL,
  LAUNCH_VX_MAX,
  LAUNCH_VX_MIN,
  TABLEAU_Y,
  TURN_COUNT,
} from "./constants";
import {
  createHarness,
  openTable,
  poseColumn,
  poseFoundation,
  poseWaste,
  type Harness,
} from "./harness";

const OPERATIONS = [
  "reset",
  "snapshot",
  "reconcile",
  "setScreen",
  "addCard",
  "removeCard",
  "setCardFaceUp",
  "clearPile",
  "clearTable",
  "addWasteSet",
  "clearWasteSets",
  "deal",
  "turnStock",
  "move",
  "autoMove",
  "pointerDown",
  "pointerMove",
  "pointerUp",
  "setAutoFlip",
  "setWinDetect",
  "setLaunching",
  "setTrailPainting",
  "addFlyer",
  "setFlyerPosition",
  "setFlyerVelocity",
  "removeFlyer",
  "clearFlyers",
  "setLaunchClock",
  "clearTrail",
  "drawLaunchVx",
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

describe("the surface", () => {
  it("is reached off the engine, complete, and at its stated version", () => {
    const surface = h.debug as unknown as Record<string, unknown>;
    expect(surface.version).toBe(CASCADE_DEBUG_VERSION);
    for (const name of OPERATIONS) {
      expect(typeof surface[name], name).toBe("function");
    }
  });

  it("reports the deal mode this build was seeded for", () => {
    const shot = h.debug.snapshot();
    expect(shot.dealMode).toBe(DEAL_MODE);
    expect(shot.turnCount).toBe(TURN_COUNT);
    expect(shot.dealModeLabel).toBe(DEAL_MODE_LABEL);
  });

  it("reports every documented field, with its documented type", () => {
    openTable(h);
    poseColumn(h, 0, [
      { suit: "spades", rank: 13 },
      { suit: "hearts", rank: 12 },
    ]);
    poseColumn(h, 1, [{ suit: "hearts", rank: 3 }]);
    poseFoundation(h, 0, "hearts", 2);
    poseWaste(
      h,
      [
        { suit: "hearts", rank: 3 },
        { suit: "spades", rank: 4 },
        { suit: "hearts", rank: 5 },
      ],
      [1, 2],
    );
    h.debug.addCard("stock", 0, "diamonds", 7, false);
    h.debug.addFlyer("clubs", 9, 100, 200, 30, -40);
    h.debug.addFlyer("hearts", 9, 300, 200, -30, -40);
    h.debug.pointerDown(396, 250);
    h.debug.pointerMove(640, 94);

    const shot = h.debug.snapshot();
    expect(shot.version).toBe(1);
    expect(shot.screen).toBe("playing");
    expect(typeof shot.muted).toBe("boolean");
    for (const gate of [
      "autoFlip",
      "winDetect",
      "launching",
      "trailPainting",
    ] as const) {
      expect(typeof shot[gate], gate).toBe("boolean");
    }
    expect(Array.isArray(shot.stock)).toBe(true);
    expect(shot.foundations).toHaveLength(4);
    expect(shot.tableau).toHaveLength(7);
    expect(shot.wasteSets).toEqual([1, 2]);
    expect(shot.wasteVisibleCount).toBe(2);
    expect(shot.drag).not.toBeNull();
    expect(shot.drag?.cards[0]).toMatchObject({
      id: expect.any(Number) as number,
      suit: expect.any(String) as string,
      rank: expect.any(Number) as number,
      color: expect.any(String) as string,
      faceUp: expect.any(Boolean) as boolean,
    });
    expect(shot.dropTarget).toEqual({ pile: "foundation", index: 0 });
    expect(shot.pointer).toEqual({ x: 640, y: 94, down: true });
    expect(shot.lastPress).toMatchObject({ x: 396, y: 250 });
    expect(typeof shot.launchClock).toBe("number");
    expect(typeof shot.launched).toBe("number");
    expect(shot.flyers).toHaveLength(2);
    expect(shot.flyers[0]).toMatchObject({
      id: expect.any(Number) as number,
      x: expect.any(Number) as number,
      vy: expect.any(Number) as number,
    });
    expect(typeof shot.cascadeDone).toBe("boolean");
    expect(typeof shot.trailStamps).toBe("number");
    expect(typeof shot.simTime).toBe("number");
  });

  it("reads a card's colour off its suit", () => {
    openTable(h);
    poseColumn(h, 0, [{ suit: "diamonds", rank: 4 }]);
    poseColumn(h, 1, [{ suit: "clubs", rank: 4 }]);
    expect(h.debug.snapshot().tableau[0][0].color).toBe("red");
    expect(h.debug.snapshot().tableau[1][0].color).toBe("black");
  });

  it("changes nothing when it reads", () => {
    openTable(h);
    poseColumn(h, 0, [{ suit: "diamonds", rank: 4 }]);
    const first = JSON.stringify(h.debug.snapshot());
    h.debug.snapshot();
    expect(JSON.stringify(h.debug.snapshot())).toBe(first);
  });
});

describe("the poses", () => {
  beforeEach(() => {
    openTable(h);
  });

  it("reads back every value it sets", () => {
    h.debug.setScreen("howto");
    expect(h.debug.snapshot().screen).toBe("howto");

    h.debug.addCard("tableau", 2, "hearts", 6, false);
    const card = h.debug.snapshot().tableau[2][0];
    h.debug.setCardFaceUp(card.id, true);
    expect(h.debug.snapshot().tableau[2][0].faceUp).toBe(true);

    h.debug.addWasteSet(2);
    expect(h.debug.snapshot().wasteSets).toEqual([2]);
    expect(h.debug.snapshot().wasteVisibleCount).toBe(2);
    h.debug.clearWasteSets();
    expect(h.debug.snapshot().wasteSets).toEqual([]);
    expect(h.debug.snapshot().wasteVisibleCount).toBe(0);

    for (const gate of [
      "autoFlip",
      "winDetect",
      "launching",
      "trailPainting",
    ] as const) {
      const set = {
        autoFlip: h.debug.setAutoFlip,
        winDetect: h.debug.setWinDetect,
        launching: h.debug.setLaunching,
        trailPainting: h.debug.setTrailPainting,
      }[gate];
      set(false);
      expect(h.debug.snapshot()[gate], gate).toBe(false);
      set(true);
      expect(h.debug.snapshot()[gate], gate).toBe(true);
    }

    h.debug.addFlyer("spades", 3, 10, 20, 30, 40);
    const flyer = h.debug.snapshot().flyers[0];
    h.debug.setFlyerPosition(flyer.id, 111, 222);
    h.debug.setFlyerVelocity(flyer.id, -5, -6);
    expect(h.debug.snapshot().flyers[0]).toMatchObject({
      x: 111,
      y: 222,
      vx: -5,
      vy: -6,
    });

    h.debug.setLaunchClock(0.07);
    expect(h.debug.snapshot().launchClock).toBe(0.07);
  });

  it("draws a launch vx in range and changes nothing", () => {
    h.debug.setScreen("won");
    h.debug.addCard("foundation", 0, "spades", 13, true);
    const before = h.debug.snapshot();
    for (let draw = 0; draw < 32; draw += 1) {
      const vx = h.debug.drawLaunchVx();
      expect(Math.abs(vx)).toBeGreaterThanOrEqual(LAUNCH_VX_MIN);
      expect(Math.abs(vx)).toBeLessThanOrEqual(LAUNCH_VX_MAX);
    }
    expect(h.debug.snapshot()).toEqual(before);
  });

  it("appends a card to its pile's top and touches nothing else", () => {
    poseColumn(h, 3, [
      { suit: "spades", rank: 9 },
      { suit: "hearts", rank: 8 },
    ]);
    poseWaste(h, [{ suit: "clubs", rank: 2 }], [1]);
    const before = h.debug.snapshot();

    h.debug.addCard("tableau", 3, "clubs", 7, true);
    const after = h.debug.snapshot();
    expect(after.tableau[3]).toHaveLength(3);
    expect(after.tableau[3][2].rank).toBe(7);
    expect(after.waste).toEqual(before.waste);
    expect(after.wasteSets).toEqual(before.wasteSets);
    expect(after.stock).toEqual(before.stock);
    expect(after.foundations).toEqual(before.foundations);
  });

  it("gives every card and every flyer a distinct id", () => {
    h.debug.deal();
    const shot = h.debug.snapshot();
    const cardIds = [...shot.stock, ...shot.tableau.flat()].map(
      (card) => card.id,
    );
    expect(new Set(cardIds).size).toBe(cardIds.length);

    for (let i = 0; i < 6; i += 1) h.debug.addFlyer("spades", 3, i, 0, 0, 0);
    const flyerIds = h.debug.snapshot().flyers.map((flyer) => flyer.id);
    expect(new Set(flyerIds).size).toBe(6);
  });

  it("keeps a card's id across a move", () => {
    poseColumn(h, 0, [{ suit: "hearts", rank: 1 }]);
    const id = h.debug.snapshot().tableau[0][0].id;
    expect(h.debug.move("tableau", 0, 0, "foundation", 0)).toBe(true);
    expect(h.debug.snapshot().foundations[0][0].id).toBe(id);
  });

  it("removes exactly the named card, and its waste set with it", () => {
    poseWaste(
      h,
      [
        { suit: "clubs", rank: 2 },
        { suit: "hearts", rank: 3 },
      ],
      [2],
    );
    const ids = h.debug.snapshot().waste.map((card) => card.id);
    h.debug.removeCard(ids[1]);
    expect(h.debug.snapshot().waste.map((card) => card.id)).toEqual([ids[0]]);
    expect(h.debug.snapshot().wasteSets).toEqual([1]);
  });

  it("empties one pile, or every pile, leaving the flyers and gates alone", () => {
    poseColumn(h, 0, [{ suit: "spades", rank: 9 }]);
    poseColumn(h, 1, [{ suit: "hearts", rank: 9 }]);
    poseWaste(h, [{ suit: "clubs", rank: 2 }], [1]);
    h.debug.addFlyer("spades", 3, 0, 0, 0, 0);
    h.debug.setAutoFlip(false);

    h.debug.clearPile("tableau", 0);
    expect(h.debug.snapshot().tableau[0]).toHaveLength(0);
    expect(h.debug.snapshot().tableau[1]).toHaveLength(1);

    h.debug.clearPile("waste", 0);
    expect(h.debug.snapshot().wasteSets).toEqual([]);

    poseColumn(h, 2, [{ suit: "spades", rank: 4 }]);
    h.debug.clearTable();
    const shot = h.debug.snapshot();
    expect(
      shot.stock.concat(shot.waste, ...shot.foundations, ...shot.tableau),
    ).toEqual([]);
    expect(shot.wasteSets).toEqual([]);
    expect(shot.flyers).toHaveLength(1);
    expect(shot.autoFlip).toBe(false);
  });

  it("removes and clears flyers by id and wholesale", () => {
    h.debug.addFlyer("spades", 3, 0, 0, 0, 0);
    h.debug.addFlyer("hearts", 3, 0, 0, 0, 0);
    const [first] = h.debug.snapshot().flyers;
    h.debug.removeFlyer(first.id);
    expect(h.debug.snapshot().flyers).toHaveLength(1);
    h.debug.clearFlyers();
    expect(h.debug.snapshot().flyers).toHaveLength(0);
  });

  it("fails loudly on a pile, a card or a flyer that is not there", () => {
    // A call whose subject the table does not hold names nothing to act on, so
    // it throws rather than passing quietly with the table unchanged
    // (specs/instrumentation.md, The operations).
    const before = JSON.stringify(h.debug.snapshot());
    expect(() => h.debug.addCard("foundation", 9, "spades", 1, true)).toThrow(
      RangeError,
    );
    expect(() => h.debug.clearPile("tableau", 12)).toThrow(RangeError);
    expect(() => h.debug.removeCard(9999)).toThrow(RangeError);
    expect(() => h.debug.setCardFaceUp(9999, true)).toThrow(RangeError);
    expect(() => h.debug.setFlyerPosition(9999, 1, 1)).toThrow(RangeError);
    expect(() => h.debug.setFlyerVelocity(9999, 1, 1)).toThrow(RangeError);
    expect(() => h.debug.removeFlyer(9999)).toThrow(RangeError);
    expect(JSON.stringify(h.debug.snapshot())).toBe(before);
  });
});

describe("reset", () => {
  it("restores every declared field to its title-screen value", async () => {
    openTable(h);
    poseColumn(h, 0, [{ suit: "spades", rank: 13 }]);
    poseWaste(h, [{ suit: "hearts", rank: 4 }], [1]);
    h.debug.addFlyer("spades", 3, 10, 10, 10, 10);
    h.debug.setAutoFlip(false);
    h.debug.setWinDetect(false);
    h.debug.setLaunching(false);
    h.debug.setTrailPainting(false);
    h.debug.setLaunchClock(0.5);
    h.debug.pointerDown(300, 300);
    await h.advance(10);

    h.debug.reset();
    const shot = h.debug.snapshot();
    expect(shot.screen).toBe("title");
    expect(
      shot.stock.concat(shot.waste, ...shot.foundations, ...shot.tableau),
    ).toEqual([]);
    expect(shot.wasteSets).toEqual([]);
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

  it("leaves the runtime's mute bit exactly as it stands", () => {
    openTable(h);
    h.engine.world.audio.setMuted(true);
    h.debug.reset();
    expect(h.debug.snapshot().muted).toBe(true);
    h.engine.world.audio.setMuted(false);
    h.debug.reset();
    expect(h.debug.snapshot().muted).toBe(false);
  });

  it("clears the painted table", async () => {
    openTable(h);
    h.debug.addFlyer("hearts", 5, 400, 300, 40, 0);
    await h.advance(10);
    expect(h.debug.snapshot().trailStamps).toBeGreaterThan(0);
    h.debug.reset();
    expect(h.debug.snapshot().trailStamps).toBe(0);
  });
});

describe("reconcile", () => {
  /** How far inside the card's top-left the grab below presses. */
  const GRAB_DY = 8;

  /**
   * A black Queen taken into hand off column 0 and carried over column 1.
   *
   * The gesture is the real one: the press grabs through the pointer path and
   * the move carries the run, so `dropTarget` is whatever that path decided for
   * the table as it stood at the move.
   */
  function heldOverColumn(): void {
    openTable(h);
    poseColumn(h, 0, [{ suit: "spades", rank: 12 }]);
    h.debug.pointerDown(COLUMN_X[0] + CARD_W / 2, TABLEAU_Y + GRAB_DY);
    h.debug.pointerMove(COLUMN_X[1] + CARD_W / 2, TABLEAU_Y + GRAB_DY);
  }

  it("re-derives a stored reading from a posed table", () => {
    heldOverColumn();
    // An empty column takes a King alone, so the held black Queen has no target
    // yet.
    expect(h.debug.snapshot().dropTarget).toBeNull();

    // Posing a red King under it makes the column take the run. The pose writes
    // the column, not the drop target, so until the readings are brought into
    // agreement `dropTarget` is still answering for the table as it was.
    poseColumn(h, 1, [{ suit: "hearts", rank: 13 }]);
    h.debug.reconcile();
    expect(h.debug.snapshot().dropTarget).toEqual({
      pile: "tableau",
      index: 1,
    });

    // And back the other way: a black King under a black Queen is refused.
    h.debug.clearPile("tableau", 1);
    poseColumn(h, 1, [{ suit: "clubs", rank: 13 }]);
    h.debug.reconcile();
    expect(h.debug.snapshot().dropTarget).toBeNull();

    // The run is still in hand: nothing was moved to make the reading agree.
    expect(h.debug.snapshot().drag?.cards[0].rank).toBe(12);
    expect(h.debug.snapshot().tableau[0]).toEqual([]);
  });

  it("advances nothing", () => {
    openTable(h);
    poseColumn(h, 0, [{ suit: "spades", rank: 5 }]);
    h.debug.addFlyer("hearts", 7, 100, 200, 40, -60);
    h.debug.setLaunchClock(0.25);
    h.debug.pointerDown(10, 10);

    const before = h.debug.snapshot();
    h.debug.reconcile();
    const once = h.debug.snapshot();
    h.debug.reconcile();
    const twice = h.debug.snapshot();

    // The clock, the flight and every gate stand exactly where they were, and a
    // second call is worth no more than the first.
    expect(once).toEqual(before);
    expect(twice).toEqual(once);
    expect(once.simTime).toBe(before.simTime);
    expect(once.launchClock).toBe(0.25);
    expect(once.flyers).toEqual(before.flyers);
    expect(once.trailStamps).toBe(before.trailStamps);
  });

  it("is legal on every screen", () => {
    for (const screen of ["title", "howto", "playing", "won"] as const) {
      h.debug.setScreen(screen);
      h.debug.reconcile();
      expect(h.debug.snapshot().screen).toBe(screen);
    }
  });
});
