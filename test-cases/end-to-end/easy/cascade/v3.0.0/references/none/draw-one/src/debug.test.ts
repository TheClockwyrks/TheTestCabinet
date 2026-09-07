import { describe, expect, it } from "vitest";
import { dealCards, turnStock } from "./board";
import { updateCascade } from "./cascade";
import {
  CASCADE_DEBUG_VERSION,
  DEAL_MODE,
  DEAL_MODE_LABEL,
  FOUNDATION_X,
  LAUNCH_INTERVAL,
  LAUNCH_VX_MAX,
  LAUNCH_VX_MIN,
  TOP_ROW_Y,
  TURN_COUNT,
} from "./constants";
import { createDebugApi, type CascadeDebugApi, type DebugClock } from "./debug";
import { RecordingAudio, put, testState } from "./harness.test-support";
import type { CascadeState } from "./state";

/** A clock that records what it was asked to do; the runtime owns the real one. */
class TestClock implements DebugClock {
  stepping = true;
  readonly runs: [number, number][] = [];
  readonly state: CascadeState;

  constructor(state: CascadeState) {
    this.state = state;
  }

  setAutoStep(enabled: boolean): void {
    this.stepping = enabled;
  }

  advance(seconds: number, frames = 1): void {
    this.runs.push([seconds, frames]);
    const step = seconds / frames;
    for (let i = 0; i < frames; i += 1) {
      this.state.simTime += step;
      updateCascade(this.state, step);
    }
  }
}

function surface(): {
  api: CascadeDebugApi;
  state: CascadeState;
  clock: TestClock;
  audio: RecordingAudio;
} {
  const state = testState();
  const clock = new TestClock(state);
  const audio = new RecordingAudio();
  return { api: createDebugApi(state, clock, audio), state, clock, audio };
}

describe("the surface", () => {
  it("carries every operation the specification names, and its version", () => {
    const { api } = surface();
    expect(api.version).toBe(CASCADE_DEBUG_VERSION);
    for (const name of [
      "reset",
      "snapshot",
      "setAutoStep",
      "advance",
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
    ]) {
      expect(typeof (api as unknown as Record<string, unknown>)[name]).toBe(
        "function",
      );
    }
  });

  it("reports the whole documented snapshot shape", () => {
    const { api, state } = surface();
    api.setScreen("playing");
    api.addCard("stock", 0, "spades", 4, false);
    api.addCard("waste", 0, "hearts", 5, true);
    api.addCard("waste", 0, "clubs", 6, true);
    api.addWasteSet(1);
    api.addWasteSet(1);
    api.addCard("foundation", 1, "diamonds", 1, true);
    api.addCard("tableau", 2, "spades", 13, true);
    api.addFlyer("hearts", 7, 100, 200, 10, -20);
    api.pointerDown(468 + 50, 180 + 8);

    const shot = api.snapshot();
    expect(shot).toMatchObject({
      version: CASCADE_DEBUG_VERSION,
      screen: "playing",
      dealMode: DEAL_MODE,
      turnCount: TURN_COUNT,
      dealModeLabel: DEAL_MODE_LABEL,
      muted: false,
      autoFlip: true,
      winDetect: true,
      launching: true,
      trailPainting: true,
      wasteSets: [1, 1],
      wasteVisibleCount: 1,
      cascadeDone: false,
      trailStamps: 0,
      launched: 0,
    });
    expect(shot.foundations).toHaveLength(4);
    expect(shot.tableau).toHaveLength(7);
    expect(shot.stock[0]).toEqual({
      id: expect.any(Number),
      suit: "spades",
      rank: 4,
      color: "black",
      faceUp: false,
    });
    expect(shot.flyers[0]).toMatchObject({ suit: "hearts", rank: 7, vy: -20 });
    expect(shot.pointer).toEqual({ x: 518, y: 188, down: true });
    expect(shot.lastPress).toEqual({ x: 518, y: 188, at: 0 });
    expect(shot.drag?.cards).toHaveLength(1);
    expect(shot.drag?.fromPile).toBe("tableau");
    expect(shot.simTime).toBe(state.simTime);
  });

  it("reads back every pose", () => {
    const { api } = surface();
    api.setScreen("howto");
    expect(api.snapshot().screen).toBe("howto");

    api.addCard("tableau", 0, "spades", 9, false);
    const id = api.snapshot().tableau[0][0].id;
    api.setCardFaceUp(id, true);
    expect(api.snapshot().tableau[0][0].faceUp).toBe(true);

    api.addWasteSet(3);
    expect(api.snapshot().wasteSets).toEqual([3]);
    expect(api.snapshot().wasteVisibleCount).toBe(3);
    api.clearWasteSets();
    expect(api.snapshot().wasteSets).toEqual([]);
    expect(api.snapshot().wasteVisibleCount).toBe(0);

    for (const gate of [
      "setAutoFlip",
      "setWinDetect",
      "setLaunching",
      "setTrailPainting",
    ] as const) {
      api[gate](false);
    }
    expect(api.snapshot()).toMatchObject({
      autoFlip: false,
      winDetect: false,
      launching: false,
      trailPainting: false,
    });

    api.addFlyer("clubs", 2, 0, 0, 0, 0);
    const flyerId = api.snapshot().flyers[0].id;
    api.setFlyerPosition(flyerId, 12, 34);
    api.setFlyerVelocity(flyerId, 56, 78);
    expect(api.snapshot().flyers[0]).toMatchObject({
      x: 12,
      y: 34,
      vx: 56,
      vy: 78,
    });
    api.setLaunchClock(0.09);
    expect(api.snapshot().launchClock).toBe(0.09);
    api.removeFlyer(flyerId);
    expect(api.snapshot().flyers).toHaveLength(0);
  });

  it("draws a launch vx in range and changes nothing", () => {
    const { api } = surface();
    api.setScreen("won");
    api.addCard("foundation", 0, "spades", 13, true);
    const before = api.snapshot();
    for (let draw = 0; draw < 32; draw += 1) {
      const vx = api.drawLaunchVx();
      expect(Math.abs(vx)).toBeGreaterThanOrEqual(LAUNCH_VX_MIN);
      expect(Math.abs(vx)).toBeLessThanOrEqual(LAUNCH_VX_MAX);
    }
    expect(api.snapshot()).toEqual(before);
  });

  it("appends a card and touches nothing else", () => {
    const { api } = surface();
    api.addCard("tableau", 0, "spades", 2, true);
    api.addCard("tableau", 0, "hearts", 3, true);
    api.addWasteSet(2);
    const before = api.snapshot();
    api.addCard("tableau", 0, "clubs", 4, true);
    const after = api.snapshot();
    expect(after.tableau[0]).toHaveLength(3);
    expect(after.tableau[0][2].rank).toBe(4);
    expect(after.wasteSets).toEqual(before.wasteSets);
    expect(after.tableau.slice(1)).toEqual(before.tableau.slice(1));
    expect(after.foundations).toEqual(before.foundations);
  });

  it("removes exactly one card, off the newest waste set when it is on the waste", () => {
    const { api } = surface();
    api.addCard("waste", 0, "spades", 2, true);
    api.addCard("waste", 0, "hearts", 3, true);
    api.addWasteSet(2);
    const middle = api.snapshot().waste[0].id;
    api.removeCard(middle);
    expect(api.snapshot().waste.map((c) => c.rank)).toEqual([3]);
    expect(api.snapshot().wasteSets).toEqual([1]);
    // Removing a card no pile holds is simply nothing.
    api.removeCard(9999);
    expect(api.snapshot().waste).toHaveLength(1);
  });

  it("clears one pile, and clears the whole table with its sets", () => {
    const { api } = surface();
    api.addCard("tableau", 1, "spades", 2, true);
    api.addCard("waste", 0, "hearts", 3, true);
    api.addWasteSet(1);
    api.addFlyer("clubs", 4, 1, 2, 3, 4);
    api.clearPile("waste", 0);
    expect(api.snapshot().waste).toHaveLength(0);
    expect(api.snapshot().wasteSets).toEqual([]);
    expect(api.snapshot().tableau[1]).toHaveLength(1);

    api.addCard("waste", 0, "hearts", 3, true);
    api.addWasteSet(1);
    api.clearTable();
    const shot = api.snapshot();
    expect(shot.tableau.every((p) => p.length === 0)).toBe(true);
    expect(shot.stock).toHaveLength(0);
    expect(shot.waste).toHaveLength(0);
    expect(shot.wasteSets).toEqual([]);
    expect(shot.flyers).toHaveLength(1);
    expect(shot.autoFlip).toBe(true);
  });

  it("refuses to name a pile that is not on the table", () => {
    const { api } = surface();
    expect(() => api.addCard("tableau", 9, "spades", 1, true)).toThrow(
      /names no pile/,
    );
    expect(() => api.clearPile("foundation", 7)).toThrow(/names no pile/);
    expect(() => api.addWasteSet(-1)).toThrow(/non-negative/);
  });

  it("reports what a move decided, and leaves a refused board alone", () => {
    const { api } = surface();
    api.addCard("tableau", 0, "hearts", 1, true);
    expect(api.move("tableau", 0, 0, "foundation", 0)).toBe(true);
    expect(api.snapshot().foundations[0]).toHaveLength(1);
    api.addCard("tableau", 1, "hearts", 5, true);
    const before = api.snapshot();
    expect(api.move("tableau", 1, 0, "foundation", 0)).toBe(false);
    expect(api.snapshot()).toEqual(before);
    // The stock is never a source, and a pile is never a target.
    expect(api.move("stock", 0, 0, "foundation", 0)).toBe(false);
    expect(api.move("tableau", 1, 0, "waste", 0)).toBe(false);
  });

  it("keeps a card's id across a move", () => {
    const { api } = surface();
    api.addCard("tableau", 0, "hearts", 1, true);
    const id = api.snapshot().tableau[0][0].id;
    api.move("tableau", 0, 0, "foundation", 2);
    expect(api.snapshot().foundations[2][0].id).toBe(id);
  });

  it("deals a full deck afresh, and clears the painted table", () => {
    const one = surface();
    one.api.reset();
    one.state.trailStamps = 30;
    one.api.deal();
    const shape = (api: CascadeDebugApi) =>
      api.snapshot().tableau.map((c) => c.map((x) => `${x.suit}${x.rank}`));
    expect(shape(one.api).flat()).toHaveLength(28);
    expect(one.api.snapshot().trailStamps).toBe(0);
    // A deal leaves the screen alone.
    expect(one.api.snapshot().screen).toBe("title");

    const other = surface();
    other.api.reset();
    other.api.deal();
    expect(shape(other.api)).not.toEqual(shape(one.api));
  });

  it("restores every declared field, and leaves muted alone", () => {
    const { api, state, audio } = surface();
    api.setScreen("playing");
    api.deal();
    api.setAutoFlip(false);
    api.setWinDetect(false);
    api.setLaunching(false);
    api.setTrailPainting(false);
    api.addFlyer("clubs", 4, 1, 2, 3, 4);
    api.setLaunchClock(1.5);
    state.trailStamps = 7;
    state.cascadeDone = true;
    state.launched = 12;
    audio.setMuted(true);
    state.muted = true;

    api.reset();
    const shot = api.snapshot();
    expect(shot).toMatchObject({
      screen: "title",
      wasteSets: [],
      wasteVisibleCount: 0,
      autoFlip: true,
      winDetect: true,
      launching: true,
      trailPainting: true,
      launchClock: 0,
      launched: 0,
      cascadeDone: false,
      trailStamps: 0,
      simTime: 0,
      drag: null,
      dropTarget: null,
      lastPress: null,
      muted: true,
    });
    expect(shot.flyers).toHaveLength(0);
    expect(shot.stock).toHaveLength(0);
    expect(shot.pointer).toEqual({ x: 0, y: 0, down: false });
  });

  it("hands the clock to the runtime and nothing else", () => {
    const { api, clock } = surface();
    api.setAutoStep(false);
    expect(clock.stepping).toBe(false);
    api.advance(1, 60);
    expect(clock.runs).toEqual([[1, 60]]);
    expect(api.snapshot().simTime).toBeCloseTo(1, 9);
  });

  it("turns the stock through the game's own code", () => {
    const { api, state } = surface();
    dealCards(state);
    api.turnStock();
    expect(api.snapshot().waste).toHaveLength(TURN_COUNT);
    expect(api.snapshot().wasteSets).toEqual([TURN_COUNT]);
  });

  it("sends a playable card home and reports whether it went", () => {
    const { api, state } = surface();
    put(state, "stock", 0, "hearts", 1, false);
    turnStock(state);
    expect(api.autoMove("waste", 0)).toBe(true);
    expect(api.autoMove("waste", 0)).toBe(false);
  });

  it("clears the painted layer and the flight separately", () => {
    const { api, state } = surface();
    api.addFlyer("clubs", 4, 400, 200, 0, 0);
    updateCascade(state, 1 / 60);
    expect(api.snapshot().trailStamps).toBe(1);
    api.clearTrail();
    expect(api.snapshot().trailStamps).toBe(0);
    expect(api.snapshot().flyers).toHaveLength(1);
    api.clearFlyers();
    expect(api.snapshot().flyers).toHaveLength(0);
  });

  it("launches from the foundation anchors once the game is won", () => {
    const { api, state } = surface();
    state.screen = "won";
    state.launchClock = LAUNCH_INTERVAL;
    api.addCard("foundation", 0, "spades", 13, true);
    updateCascade(state, 1 / 240);
    expect(api.snapshot().flyers[0]).toMatchObject({
      x: FOUNDATION_X[0],
      y: TOP_ROW_Y,
    });
    expect(api.snapshot().launched).toBe(1);
  });
});
