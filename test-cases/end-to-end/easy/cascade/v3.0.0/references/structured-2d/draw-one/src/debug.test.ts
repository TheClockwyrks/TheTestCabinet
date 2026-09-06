// The debugging and automation surface: that it is complete, that every pose is
// read back by the snapshot, and that each faculty gate holds exactly one
// faculty (specs/instrumentation.md).

import { beforeEach, afterEach, describe, expect, it } from "vitest";
import {
  CASCADE_DEBUG_VERSION,
  DEAL_MODE,
  DEAL_MODE_LABEL,
  LAUNCH_INTERVAL,
  TURN_COUNT,
} from "./constants";
import {
  createHarness,
  openTable,
  poseColumn,
  poseFoundation,
  poseNearlyWon,
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

const OPERATIONS = [
  "reset",
  "snapshot",
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
] as const;

describe("the surface", () => {
  it("carries every operation the specification names, and its version", () => {
    const surface = h.debug as unknown as Record<string, unknown>;
    for (const name of OPERATIONS) {
      expect(typeof surface[name], name).toBe("function");
    }
    expect(h.debug.version).toBe(CASCADE_DEBUG_VERSION);
    expect(h.debug.snapshot().version).toBe(CASCADE_DEBUG_VERSION);
  });

  it("reports this build's deal mode", () => {
    const shot = h.debug.snapshot();
    expect(shot.dealMode).toBe(DEAL_MODE);
    expect(shot.dealModeLabel).toBe(DEAL_MODE_LABEL);
    expect(shot.turnCount).toBe(TURN_COUNT);
  });

  it("is reached through the engine rather than the page", () => {
    expect(h.engine.debug).toBe(h.debug);
    expect((globalThis as Record<string, unknown>).__cascade).toBeUndefined();
  });
});

describe("poses read back", () => {
  it("reports the screen, a card's face, the sets, the gates and a flyer", () => {
    const { debug } = h;
    openTable(debug);

    debug.setScreen("howto");
    expect(debug.snapshot().screen).toBe("howto");
    debug.setScreen("playing");

    const [id] = poseColumn(debug, 2, [{ suit: "hearts", rank: 7 }]);
    debug.setCardFaceUp(id, false);
    expect(debug.snapshot().tableau[2][0].faceUp).toBe(false);
    debug.setCardFaceUp(id, true);
    expect(debug.snapshot().tableau[2][0].faceUp).toBe(true);

    poseWaste(
      debug,
      [
        { suit: "clubs", rank: 2 },
        { suit: "spades", rank: 3 },
        { suit: "diamonds", rank: 4 },
      ],
      [1, 2],
    );
    expect(debug.snapshot().wasteSets).toEqual([1, 2]);
    expect(debug.snapshot().wasteVisibleCount).toBe(2);
    debug.clearWasteSets();
    expect(debug.snapshot().wasteSets).toEqual([]);
    expect(debug.snapshot().wasteVisibleCount).toBe(0);

    for (const set of [
      ["setAutoFlip", "autoFlip"],
      ["setWinDetect", "winDetect"],
      ["setLaunching", "launching"],
      ["setTrailPainting", "trailPainting"],
    ] as const) {
      const [setter, field] = set;
      debug[setter](false);
      expect(debug.snapshot()[field], field).toBe(false);
      debug[setter](true);
      expect(debug.snapshot()[field], field).toBe(true);
    }

    debug.addFlyer("spades", 1, 100, 200, 30, -40);
    const flyer = debug.snapshot().flyers[0];
    expect(flyer).toMatchObject({ x: 100, y: 200, vx: 30, vy: -40 });
    debug.setFlyerPosition(flyer.id, 11, 22);
    debug.setFlyerVelocity(flyer.id, 33, 44);
    expect(debug.snapshot().flyers[0]).toMatchObject({
      x: 11,
      y: 22,
      vx: 33,
      vy: 44,
    });

    debug.setLaunchClock(0.05);
    expect(debug.snapshot().launchClock).toBeCloseTo(0.05, 10);
  });

  it("reports the pointer and the last press", () => {
    const { debug } = h;
    openTable(debug);
    debug.pointerDown(200, 300);
    expect(debug.snapshot().pointer).toEqual({ x: 200, y: 300, down: true });
    expect(debug.snapshot().lastPress).toMatchObject({ x: 200, y: 300 });
    debug.pointerMove(210, 310);
    expect(debug.snapshot().pointer).toEqual({ x: 210, y: 310, down: true });
    debug.pointerUp(220, 320);
    expect(debug.snapshot().pointer).toEqual({ x: 220, y: 320, down: false });
  });
});

describe("the table is posed one card at a time", () => {
  it("appends a card to the pile's top and touches nothing else", () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 3, [
      { suit: "spades", rank: 5 },
      { suit: "hearts", rank: 4 },
    ]);
    const before = debug.snapshot();
    debug.addCard("tableau", 3, "clubs", 3, true);
    const after = debug.snapshot();

    expect(after.tableau[3]).toHaveLength(3);
    expect(after.tableau[3][2]).toMatchObject({ suit: "clubs", rank: 3 });
    expect(after.tableau.filter((_, i) => i !== 3)).toEqual(
      before.tableau.filter((_, i) => i !== 3),
    );
    expect(after.stock).toEqual(before.stock);
    expect(after.waste).toEqual(before.waste);
    expect(after.wasteSets).toEqual(before.wasteSets);
    expect(after.foundations).toEqual(before.foundations);
  });

  it("gives every card a distinct id and reports its color", () => {
    const { debug } = h;
    debug.reset();
    debug.deal();
    const shot = debug.snapshot();
    const cards = [
      ...shot.stock,
      ...shot.waste,
      ...shot.foundations.flat(),
      ...shot.tableau.flat(),
    ];
    expect(cards).toHaveLength(52);
    expect(new Set(cards.map((card) => card.id)).size).toBe(52);
    for (const card of cards) {
      const red = card.suit === "hearts" || card.suit === "diamonds";
      expect(card.color).toBe(red ? "red" : "black");
    }
  });

  it("removes exactly the named card", () => {
    const { debug } = h;
    openTable(debug);
    const ids = poseColumn(debug, 1, [
      { suit: "spades", rank: 5 },
      { suit: "hearts", rank: 4 },
      { suit: "clubs", rank: 3 },
    ]);
    debug.removeCard(ids[1]);
    expect(debug.snapshot().tableau[1].map((card) => card.id)).toEqual([
      ids[0],
      ids[2],
    ]);
  });

  it("empties one pile with clearPile and every pile with clearTable", () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [{ suit: "spades", rank: 5 }]);
    poseColumn(debug, 4, [{ suit: "hearts", rank: 9 }]);
    poseFoundation(debug, 2, "clubs", 3);
    poseWaste(debug, [{ suit: "diamonds", rank: 6 }], [1]);

    debug.clearPile("tableau", 0);
    let shot = debug.snapshot();
    expect(shot.tableau[0]).toHaveLength(0);
    expect(shot.tableau[4]).toHaveLength(1);
    expect(shot.foundations[2]).toHaveLength(3);
    expect(shot.waste).toHaveLength(1);

    debug.clearPile("waste", 0);
    shot = debug.snapshot();
    expect(shot.waste).toHaveLength(0);
    expect(shot.wasteSets).toEqual([]);

    debug.addFlyer("spades", 1, 10, 10, 0, 0);
    debug.setAutoFlip(false);
    debug.clearTable();
    shot = debug.snapshot();
    expect(
      shot.stock.concat(
        shot.waste,
        shot.foundations.flat(),
        shot.tableau.flat(),
      ),
    ).toHaveLength(0);
    expect(shot.wasteSets).toEqual([]);
    expect(shot.flyers).toHaveLength(1);
    expect(shot.autoFlip).toBe(false);
  });
});

describe("reset", () => {
  it("returns every declared field to its title-screen value", async () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [{ suit: "spades", rank: 13 }]);
    poseWaste(debug, [{ suit: "hearts", rank: 5 }], [1]);
    debug.pointerDown(224 + 50, 180 + 20);
    debug.addFlyer("clubs", 4, 10, 10, 50, 0);
    debug.setAutoFlip(false);
    debug.setWinDetect(false);
    debug.setLaunching(false);
    debug.setTrailPainting(false);
    debug.setLaunchClock(0.1);
    await h.advance(2);

    debug.reset();
    const shot = debug.snapshot();
    expect(shot.screen).toBe("title");
    expect(
      shot.stock.concat(
        shot.waste,
        shot.foundations.flat(),
        shot.tableau.flat(),
      ),
    ).toHaveLength(0);
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

  it("deals a full board afresh on every deal", () => {
    const { debug } = h;
    const dealt = (): string => {
      debug.reset();
      debug.deal();
      const shot = debug.snapshot();
      return JSON.stringify(
        [...shot.tableau, shot.stock].map((pile) =>
          pile.map(
            (card) => `${card.suit}${card.rank}${card.faceUp ? "u" : "d"}`,
          ),
        ),
      );
    };
    expect(JSON.parse(dealt()).flat()).toHaveLength(52);
    expect(dealt()).not.toBe(dealt());
  });
});

describe("the faculty gates", () => {
  it("gates the automatic flip and nothing else", () => {
    const { debug } = h;
    const exposeUnder = (): void => {
      openTable(debug);
      poseColumn(debug, 0, [
        { suit: "spades", rank: 9, faceUp: false },
        { suit: "hearts", rank: 4 },
      ]);
      poseColumn(debug, 1, [{ suit: "spades", rank: 5 }]);
    };

    exposeUnder();
    debug.setAutoFlip(false);
    expect(debug.move("tableau", 0, 1, "tableau", 1)).toBe(true);
    expect(debug.snapshot().tableau[0][0].faceUp).toBe(false);

    exposeUnder();
    expect(debug.move("tableau", 0, 1, "tableau", 1)).toBe(true);
    expect(debug.snapshot().tableau[0][0].faceUp).toBe(true);
  });

  it("gates win detection and nothing else", () => {
    const { debug } = h;
    openTable(debug);
    debug.setWinDetect(false);
    const { column, row } = poseNearlyWon(debug);
    expect(debug.move("tableau", column, row, "foundation", 3)).toBe(true);
    expect(debug.snapshot().screen).toBe("playing");

    openTable(debug);
    const again = poseNearlyWon(debug);
    expect(
      debug.move("tableau", again.column, again.row, "foundation", 3),
    ).toBe(true);
    expect(debug.snapshot().screen).toBe("won");
  });

  it("gates the launching while a flyer already in flight keeps moving", async () => {
    const { debug } = h;
    openTable(debug);
    poseNearlyWon(debug);
    const { column, row } = { column: 0, row: 0 };
    debug.move("tableau", column, row, "foundation", 3);
    debug.setLaunching(false);
    debug.setTrailPainting(false);
    debug.clearFlyers();
    debug.addFlyer("spades", 1, 300, 100, 120, 0);
    const before = debug.snapshot();
    await h.seconds(1);
    const after = debug.snapshot();
    expect(after.launched).toBe(before.launched);
    expect(after.flyers).toHaveLength(1);
    expect(after.flyers[0].x).toBeGreaterThan(before.flyers[0].x + 100);
  });

  it("gates the trail's painting while the flyer still moves", async () => {
    const { debug } = h;
    openTable(debug);
    debug.setLaunching(false);
    debug.addFlyer("spades", 1, 300, 100, 60, 0);

    debug.setTrailPainting(false);
    const held = debug.snapshot().trailStamps;
    await h.seconds(1);
    expect(debug.snapshot().trailStamps).toBe(held);

    debug.setTrailPainting(true);
    await h.seconds(1);
    expect(debug.snapshot().trailStamps).toBeGreaterThan(held);
  });

  it("starts every gate on, and clearTrail leaves the flyers standing", async () => {
    const { debug } = h;
    debug.reset();
    const shot = debug.snapshot();
    expect([
      shot.autoFlip,
      shot.winDetect,
      shot.launching,
      shot.trailPainting,
    ]).toEqual([true, true, true, true]);

    debug.setScreen("playing");
    debug.addFlyer("hearts", 2, 400, 200, 40, 0);
    await h.seconds(0.5);
    expect(debug.snapshot().trailStamps).toBeGreaterThan(0);
    debug.clearTrail();
    expect(debug.snapshot().trailStamps).toBe(0);
    expect(debug.snapshot().flyers).toHaveLength(1);
  });
});

describe("the clock", () => {
  it("accumulates game time on every screen", async () => {
    const { debug } = h;
    for (const screen of ["title", "howto", "playing"] as const) {
      debug.reset();
      debug.setScreen(screen);
      await h.seconds(1);
      expect(debug.snapshot().simTime, screen).toBeCloseTo(1, 6);
    }
  });

  it("advances on elapsed time alone, however the interval is divided", async () => {
    const { debug } = h;
    const run = async (step: number): Promise<[number, number]> => {
      debug.reset();
      debug.setScreen("playing");
      debug.setLaunching(false);
      debug.addFlyer("spades", 7, 400, 100, 200, 0);
      await h.seconds(1, step);
      const shot = debug.snapshot();
      return [shot.simTime, shot.flyers[0].x];
    };
    const coarse = await run(1);
    const fine = await run(1 / 60);
    expect(coarse[0]).toBeCloseTo(fine[0], 6);
    expect(coarse[1]).toBeCloseTo(fine[1], 6);
  });

  it("draws each cascade's launch velocities afresh", async () => {
    const { debug } = h;
    const run = async (): Promise<string> => {
      debug.reset();
      debug.setScreen("playing");
      debug.setTrailPainting(false);
      poseNearlyWon(debug);
      debug.move("tableau", 0, 0, "foundation", 3);
      expect(debug.snapshot().launchClock).toBeCloseTo(LAUNCH_INTERVAL, 10);
      await h.seconds(1.5, 1 / 240);
      return JSON.stringify(debug.snapshot().flyers.map((f) => f.vx));
    };
    expect(await run()).not.toBe(await run());
  });
});
