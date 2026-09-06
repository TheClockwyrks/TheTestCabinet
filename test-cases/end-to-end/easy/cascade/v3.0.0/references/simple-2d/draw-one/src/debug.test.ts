import { describe, expect, it } from "vitest";
import {
  CASCADE_DEBUG_VERSION,
  DEAL_MODE,
  DEAL_MODE_LABEL,
  DECK_SIZE,
  RANK_MAX,
  SUITS,
  TURN_COUNT,
} from "./constants";
import { createDebugApi } from "./debug";
import { openingState } from "./flow";
import type { CascadeState } from "./game";

const debug = createDebugApi();

function open(): CascadeState {
  const start = debug.reset(openingState());
  return debug.clearTable(debug.setScreen(start, "playing"));
}

describe("the surface", () => {
  it("carries every operation the specification names", () => {
    for (const name of [
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
    ]) {
      expect(typeof (debug as unknown as Record<string, unknown>)[name]).toBe(
        "function",
      );
    }
    expect(debug.version).toBe(CASCADE_DEBUG_VERSION);
  });

  it("reports the deal mode this build plays", () => {
    const snap = debug.snapshot(openingState());
    expect(snap.dealMode).toBe(DEAL_MODE);
    expect(snap.turnCount).toBe(TURN_COUNT);
    expect(snap.dealModeLabel).toBe(DEAL_MODE_LABEL);
  });

  it("reads back every pose", () => {
    let state = open();
    state = debug.setScreen(state, "howto");
    expect(debug.snapshot(state).screen).toBe("howto");

    state = debug.setAutoFlip(state, false);
    state = debug.setWinDetect(state, false);
    state = debug.setLaunching(state, false);
    state = debug.setTrailPainting(state, false);
    const gates = debug.snapshot(state);
    expect([
      gates.autoFlip,
      gates.winDetect,
      gates.launching,
      gates.trailPainting,
    ]).toEqual([false, false, false, false]);

    state = debug.setLaunchClock(state, 0.12);
    expect(debug.snapshot(state).launchClock).toBe(0.12);

    state = debug.addFlyer(state, "hearts", 5, 10, 20, 30, 40);
    const flyerId = debug.snapshot(state).flyers[0].id;
    state = debug.setFlyerPosition(state, flyerId, 100, 200);
    state = debug.setFlyerVelocity(state, flyerId, -50, 60);
    expect(debug.snapshot(state).flyers[0]).toMatchObject({
      x: 100,
      y: 200,
      vx: -50,
      vy: 60,
    });

    state = debug.removeFlyer(state, flyerId);
    expect(debug.snapshot(state).flyers).toEqual([]);
  });

  it("appends a card to the top of its pile and reports its color", () => {
    let state = open();
    state = debug.addCard(state, "tableau", 3, "spades", 9, true);
    state = debug.addCard(state, "tableau", 3, "hearts", 8, false);
    const column = debug.snapshot(state).tableau[3];
    expect(column.map((c) => c.rank)).toEqual([9, 8]);
    expect(column[0].color).toBe("black");
    expect(column[1].color).toBe("red");
    expect(column[0].id).not.toBe(column[1].id);
  });

  it("touches only the pile it names", () => {
    const start = debug.addCard(open(), "tableau", 0, "spades", 9, true);
    const next = debug.addCard(start, "tableau", 1, "hearts", 8, true);
    expect(next.tableau[0]).toEqual(start.tableau[0]);
    expect(next.waste).toEqual([]);
    expect(next.wasteSets).toEqual([]);
  });

  it("removes exactly the card named and keeps the order of the rest", () => {
    let state = open();
    state = debug.addCard(state, "tableau", 0, "spades", 9, true);
    state = debug.addCard(state, "tableau", 0, "hearts", 8, true);
    state = debug.addCard(state, "tableau", 0, "clubs", 7, true);
    const middle = debug.snapshot(state).tableau[0][1].id;
    state = debug.removeCard(state, middle);
    expect(debug.snapshot(state).tableau[0].map((c) => c.rank)).toEqual([9, 7]);
    expect(debug.removeCard(state, 9999)).toBe(state);
  });

  it("sets one card's face and leaves the others", () => {
    let state = open();
    state = debug.addCard(state, "tableau", 0, "spades", 9, false);
    state = debug.addCard(state, "tableau", 0, "hearts", 8, false);
    const id = debug.snapshot(state).tableau[0][0].id;
    state = debug.setCardFaceUp(state, id, true);
    expect(debug.snapshot(state).tableau[0].map((c) => c.faceUp)).toEqual([
      true,
      false,
    ]);
  });

  it("clears one pile and leaves the other twelve", () => {
    let state = open();
    state = debug.addCard(state, "tableau", 0, "spades", 9, true);
    state = debug.addCard(state, "tableau", 1, "hearts", 8, true);
    state = debug.addCard(state, "waste", 0, "clubs", 7, true);
    state = debug.addWasteSet(state, 1);
    const cleared = debug.clearPile(state, "waste", 0);
    expect(cleared.waste).toEqual([]);
    expect(cleared.wasteSets).toEqual([]);
    expect(cleared.tableau[0]).toHaveLength(1);
    expect(cleared.tableau[1]).toHaveLength(1);
  });

  it("clears every pile and leaves the flyers and the gates", () => {
    let state = open();
    state = debug.addCard(state, "tableau", 0, "spades", 9, true);
    state = debug.addCard(state, "waste", 0, "clubs", 7, true);
    state = debug.addWasteSet(state, 1);
    state = debug.addFlyer(state, "hearts", 3, 0, 0, 0, 0);
    state = debug.setAutoFlip(state, false);
    const cleared = debug.clearTable(state);
    const snap = debug.snapshot(cleared);
    expect(
      snap.stock.concat(snap.waste, ...snap.foundations, ...snap.tableau),
    ).toEqual([]);
    expect(snap.wasteSets).toEqual([]);
    expect(snap.flyers).toHaveLength(1);
    expect(snap.autoFlip).toBe(false);
  });

  it("poses the waste's sets and derives what the waste shows", () => {
    let state = open();
    state = debug.addCard(state, "waste", 0, "spades", 9, true);
    state = debug.addCard(state, "waste", 0, "hearts", 8, true);
    expect(debug.snapshot(state).wasteVisibleCount).toBe(0);
    state = debug.addWasteSet(state, 1);
    state = debug.addWasteSet(state, 1);
    expect(debug.snapshot(state).wasteSets).toEqual([1, 1]);
    expect(debug.snapshot(state).wasteVisibleCount).toBe(1);
    state = debug.clearWasteSets(state);
    expect(debug.snapshot(state).wasteSets).toEqual([]);
    expect(debug.snapshot(state).wasteVisibleCount).toBe(0);
    expect(debug.snapshot(state).waste).toHaveLength(2);
  });

  it("reports what a move decided and leaves a refused board alone", () => {
    let state = open();
    state = debug.addCard(state, "tableau", 0, "spades", 13, true);
    state = debug.addCard(state, "tableau", 1, "hearts", 12, true);
    const [good, accepted] = debug.move(state, "tableau", 1, 0, "tableau", 0);
    expect(accepted).toBe(true);
    expect(debug.snapshot(good).tableau[0].map((c) => c.rank)).toEqual([
      13, 12,
    ]);

    const [bad, refused] = debug.move(state, "tableau", 0, 0, "tableau", 1);
    expect(refused).toBe(false);
    expect(bad).toBe(state);

    expect(debug.move(state, "tableau", 9, 0, "tableau", 0)[1]).toBe(false);
  });

  it("keeps a card's id across a move", () => {
    let state = open();
    state = debug.addCard(state, "tableau", 0, "spades", 1, true);
    const id = debug.snapshot(state).tableau[0][0].id;
    const [moved] = debug.move(state, "tableau", 0, 0, "foundation", 0);
    expect(debug.snapshot(moved).foundations[0][0].id).toBe(id);
  });

  it("reports what an auto-move decided", () => {
    let state = open();
    state = debug.addCard(state, "tableau", 0, "spades", 1, true);
    const [home, sent] = debug.autoMove(state, "tableau", 0);
    expect(sent).toBe(true);
    expect(debug.snapshot(home).foundations[0]).toHaveLength(1);
    expect(debug.autoMove(state, "tableau", 9)[1]).toBe(false);
  });

  it("deals and turns through the game's own rules", () => {
    const dealt = debug.deal(open());
    expect(debug.snapshot(dealt).stock).toHaveLength(24);
    const turned = debug.turnStock(dealt);
    expect(debug.snapshot(turned).waste).toHaveLength(TURN_COUNT);
    expect(debug.snapshot(turned).wasteSets).toEqual([TURN_COUNT]);
  });

  it("reports the pointer and the press it recorded", () => {
    let state = open();
    state = debug.pointerDown(state, 100, 200);
    expect(debug.snapshot(state).pointer).toEqual({
      x: 100,
      y: 200,
      down: true,
    });
    expect(debug.snapshot(state).lastPress).toEqual({ x: 100, y: 200, at: 0 });
    state = debug.pointerMove(state, 150, 250);
    expect(debug.snapshot(state).pointer).toEqual({
      x: 150,
      y: 250,
      down: true,
    });
    state = debug.pointerUp(state, 150, 250);
    expect(debug.snapshot(state).pointer.down).toBe(false);
  });
});

describe("reset", () => {
  it("restores every declared field and leaves muting alone", () => {
    let state: CascadeState = { ...open(), muted: true, simTime: 12 };
    state = debug.addCard(state, "tableau", 0, "spades", 13, true);
    state = debug.addFlyer(state, "hearts", 3, 5, 5, 5, 5);
    state = debug.setLaunching(state, false);
    state = debug.setLaunchClock(state, 2);
    state = { ...state, launched: 9, trailStamps: 40, cascadeDone: true };

    const snap = debug.snapshot(debug.reset(state));
    expect(snap.screen).toBe("title");
    expect(
      snap.stock.concat(snap.waste, ...snap.foundations, ...snap.tableau),
    ).toEqual([]);
    expect(snap.wasteSets).toEqual([]);
    expect(snap.drag).toBeNull();
    expect(snap.dropTarget).toBeNull();
    expect(snap.lastPress).toBeNull();
    expect(snap.pointer).toEqual({ x: 0, y: 0, down: false });
    expect([
      snap.autoFlip,
      snap.winDetect,
      snap.launching,
      snap.trailPainting,
    ]).toEqual([true, true, true, true]);
    expect(snap.launchClock).toBe(0);
    expect(snap.launched).toBe(0);
    expect(snap.flyers).toEqual([]);
    expect(snap.cascadeDone).toBe(false);
    expect(snap.trailStamps).toBe(0);
    expect(snap.simTime).toBe(0);
    expect(snap.muted).toBe(true);
  });

  it("deals afresh, so two deals lay out different boards", () => {
    const key = (state: CascadeState) =>
      debug
        .snapshot(state)
        .tableau.flat()
        .map((c) => `${c.suit}${c.rank}`)
        .join(",");
    const dealt = () => debug.deal(debug.reset(openingState()));
    expect(key(dealt()).split(",")).toHaveLength(28);
    expect(key(dealt())).not.toBe(key(dealt()));
  });
});

describe("the snapshot", () => {
  it("reports the whole documented shape", () => {
    let state = open();
    state = debug.addCard(state, "stock", 0, "spades", 2, false);
    state = debug.addCard(state, "waste", 0, "hearts", 3, true);
    state = debug.addWasteSet(state, 1);
    state = debug.addCard(state, "foundation", 0, "clubs", 1, true);
    state = debug.addCard(state, "tableau", 0, "spades", 13, true);
    state = debug.addCard(state, "tableau", 1, "hearts", 12, true);
    state = debug.addFlyer(state, "diamonds", 4, 1, 2, 3, 4);
    state = debug.addFlyer(state, "clubs", 5, 6, 7, 8, 9);
    state = debug.pointerDown(state, 407, 250);

    const snap = debug.snapshot(state);
    expect(snap.version).toBe(1);
    expect(snap.foundations).toHaveLength(4);
    expect(snap.tableau).toHaveLength(7);
    expect(snap.flyers).toHaveLength(2);
    expect(snap.drag).not.toBeNull();
    expect(snap.drag?.fromPile).toBe("tableau");
    expect(typeof snap.simTime).toBe("number");
    expect(typeof snap.muted).toBe("boolean");
  });

  it("changes nothing it reads", () => {
    const state = debug.deal(open());
    const before = JSON.stringify(debug.snapshot(state));
    debug.snapshot(state);
    expect(JSON.stringify(debug.snapshot(state))).toBe(before);
  });

  it("counts a full deal as fifty-two distinct ids", () => {
    const snap = debug.snapshot(debug.deal(open()));
    const ids = [
      ...snap.stock,
      ...snap.waste,
      ...snap.foundations.flat(),
      ...snap.tableau.flat(),
    ].map((c) => c.id);
    expect(ids).toHaveLength(DECK_SIZE);
    expect(new Set(ids).size).toBe(DECK_SIZE);
  });

  it("reports a cascade the game itself began", () => {
    let state = open();
    for (let f = 0; f < 4; f++) {
      for (let r = 1; r <= RANK_MAX; r++) {
        if (f === 0 && r === RANK_MAX) continue;
        state = debug.addCard(state, "foundation", f, SUITS[f], r, true);
      }
    }
    state = debug.addCard(state, "tableau", 0, SUITS[0], RANK_MAX, true);
    const [won, accepted] = debug.move(state, "tableau", 0, 0, "foundation", 0);
    expect(accepted).toBe(true);
    expect(debug.snapshot(won).screen).toBe("won");
  });
});
