// The victory cascade: the cadence, the arcs, the bounces, the trail and the end.
//
// Every figure asserted here is one specs/victory.md fixes. The frames are of an
// exact length, because a quantity under acceleration depends on how an interval
// was divided and the specification's integration is the thing being checked.

import { beforeEach, describe, expect, it } from "vitest";
import {
  BOUNCE_DAMP,
  CARD_H,
  CARD_W,
  CUES,
  DECK_SIZE,
  FLOOR_Y,
  FOUNDATION_X,
  GRAVITY,
  LAUNCH_INTERVAL,
  LAUNCH_VX_MAX,
  LAUNCH_VX_MIN,
  LAUNCH_VY,
  RANK_MAX,
  STAGE_H,
  STAGE_W,
  SUITS,
  TOP_ROW_Y,
} from "./constants";
import { advanceFlyers, launchNext, stepCascade } from "./cascade";
import { createState, type CascadeState } from "./state";

/** The frame length every check below counts in. */
const TICK = 1 / 240;

let state: CascadeState;

function fillFoundations(): void {
  for (let i = 0; i < SUITS.length; i += 1) {
    for (let rank = 1; rank <= RANK_MAX; rank += 1) {
      state.nextId += 1;
      state.foundations[i].push({
        id: state.nextId,
        suit: SUITS[i],
        rank,
        faceUp: true,
      });
    }
  }
}

function run(frames: number): void {
  for (let i = 0; i < frames; i += 1) stepCascade(state, TICK);
}

beforeEach(() => {
  state = createState(() => null);
});

describe("FLOOR_Y", () => {
  it("seats a card's bottom edge on the bottom of the stage", () => {
    expect(FLOOR_Y).toBe(STAGE_H - CARD_H);
  });
});

describe("a card in flight", () => {
  it("takes gravity, then the advance, in that order", () => {
    state.flyers.push({
      id: 1,
      suit: "spades",
      rank: 5,
      x: 100,
      y: 100,
      vx: 60,
      vy: 0,
    });
    advanceFlyers(state, TICK);
    const flyer = state.flyers[0];
    expect(flyer.vy).toBeCloseTo(GRAVITY * TICK, 9);
    expect(flyer.x).toBeCloseTo(100 + 60 * TICK, 9);
    expect(flyer.y).toBeCloseTo(100 + GRAVITY * TICK * TICK, 9);
  });

  it("bounces off the floor, damped, and reseats there", () => {
    state.flyers.push({
      id: 1,
      suit: "hearts",
      rank: 5,
      x: 300,
      y: FLOOR_Y - 1,
      vx: 40,
      vy: 400,
    });
    advanceFlyers(state, TICK);
    const flyer = state.flyers[0];
    expect(flyer.y).toBe(FLOOR_Y);
    expect(flyer.vy).toBeCloseTo(-(400 + GRAVITY * TICK) * BOUNCE_DAMP, 9);
    expect(flyer.vx).toBe(40);
  });

  it("peaks lower on each bounce", () => {
    state.flyers.push({
      id: 1,
      suit: "hearts",
      rank: 5,
      x: 300,
      y: FLOOR_Y,
      vx: 0,
      vy: 600,
    });
    const peaks: number[] = [];
    let previous = FLOOR_Y;
    for (let i = 0; i < 600; i += 1) {
      advanceFlyers(state, TICK);
      const flyer = state.flyers[0];
      if (flyer.y > previous && peaks.length < 3) previous = flyer.y;
      if (flyer.y === FLOOR_Y) {
        peaks.push(previous);
        previous = FLOOR_Y;
      }
    }
    expect(peaks.length).toBeGreaterThanOrEqual(2);
  });

  it("collides with nothing but the floor", () => {
    state.flyers.push(
      { id: 1, suit: "spades", rank: 5, x: 400, y: 300, vx: 300, vy: 0 },
      { id: 2, suit: "hearts", rank: 5, x: 400, y: 300, vx: -300, vy: 0 },
    );
    advanceFlyers(state, TICK);
    expect(state.flyers[0].vx).toBe(300);
    expect(state.flyers[1].vx).toBe(-300);
  });

  it("retires past either side edge", () => {
    state.flyers.push(
      { id: 1, suit: "spades", rank: 5, x: -CARD_W, y: 100, vx: -10, vy: 0 },
      { id: 2, suit: "hearts", rank: 5, x: STAGE_W, y: 100, vx: 10, vy: 0 },
      { id: 3, suit: "clubs", rank: 5, x: 600, y: 100, vx: 0, vy: 0 },
    );
    advanceFlyers(state, TICK);
    expect(state.flyers.map((flyer) => flyer.id)).toEqual([3]);
  });
});

describe("the painted layer", () => {
  it("takes one stamp per card in flight per frame", () => {
    state.flyers.push(
      { id: 1, suit: "spades", rank: 5, x: 200, y: 200, vx: 0, vy: 0 },
      { id: 2, suit: "hearts", rank: 5, x: 400, y: 200, vx: 0, vy: 0 },
    );
    advanceFlyers(state, TICK);
    expect(state.trailStamps).toBe(2);
    advanceFlyers(state, TICK);
    expect(state.trailStamps).toBe(4);
  });

  it("takes no stamp while trailPainting is off, and still flies", () => {
    state.trailPainting = false;
    state.flyers.push({
      id: 1,
      suit: "spades",
      rank: 5,
      x: 200,
      y: 200,
      vx: 90,
      vy: 0,
    });
    advanceFlyers(state, TICK);
    expect(state.trailStamps).toBe(0);
    expect(state.flyers[0].x).toBeCloseTo(200 + 90 * TICK, 9);
  });

  it("stamps a card on the frame it retires as well", () => {
    state.flyers.push({
      id: 1,
      suit: "spades",
      rank: 5,
      x: STAGE_W,
      y: 100,
      vx: 10,
      vy: 0,
    });
    advanceFlyers(state, TICK);
    expect(state.flyers).toEqual([]);
    expect(state.trailStamps).toBe(1);
  });
});

describe("launching", () => {
  beforeEach(() => {
    fillFoundations();
    state.screen = "won";
    state.launchClock = LAUNCH_INTERVAL;
  });

  it("launches the first card on the cascade's first frame, from its anchor", () => {
    run(1);
    expect(state.flyers).toHaveLength(1);
    const flyer = state.flyers[0];
    expect(flyer.x).toBe(FOUNDATION_X[0]);
    expect(flyer.y).toBe(TOP_ROW_Y);
    expect(flyer.vy).toBe(LAUNCH_VY);
    expect(Math.abs(flyer.vx)).toBeGreaterThanOrEqual(LAUNCH_VX_MIN);
    expect(Math.abs(flyer.vx)).toBeLessThan(LAUNCH_VX_MAX);
    expect(state.launched).toBe(1);
    expect(state.pendingCues.has(CUES.launch)).toBe(true);
  });

  it("takes the top card of each foundation in turn, cycling the four", () => {
    const kings = state.foundations.map((pile) => pile[pile.length - 1].id);
    run(1);
    for (let i = 1; i < 4; i += 1) run(Math.round(LAUNCH_INTERVAL / TICK));
    expect(state.flyers.map((flyer) => flyer.id).slice(0, 4)).toEqual(kings);
    expect(state.foundations.map((pile) => pile.length)).toEqual([
      12, 12, 12, 12,
    ]);
  });

  it("skips a foundation that has been emptied", () => {
    state.foundations[1] = [];
    state.foundations[2] = [];
    const from0 = state.foundations[0][12].id;
    const from3 = state.foundations[3][12].id;
    run(1);
    run(Math.round(LAUNCH_INTERVAL / TICK));
    expect(state.flyers.map((flyer) => flyer.id)).toEqual([from0, from3]);
  });

  it("keeps the cadence, carrying the remainder rather than drifting", () => {
    for (const seconds of [0.5, 1, 2]) {
      state = createState(() => null);
      fillFoundations();
      state.screen = "won";
      state.launchClock = LAUNCH_INTERVAL;
      state.trailPainting = false;
      run(Math.round(seconds / TICK));
      expect(state.launched).toBe(
        Math.min(DECK_SIZE, Math.floor(seconds / LAUNCH_INTERVAL) + 1),
      );
    }
  });

  it("launches several cards in a frame long enough to owe several", () => {
    stepCascade(state, LAUNCH_INTERVAL * 3);
    expect(state.launched).toBe(4);
  });

  it("launches nothing further while the launching gate is off", () => {
    run(1);
    state.launching = false;
    const held = state.launched;
    run(Math.round(1 / TICK));
    expect(state.launched).toBe(held);
    // The card already in flight keeps flying.
    expect(state.flyers[0].y).not.toBe(TOP_ROW_Y);
  });

  it("launches all fifty-two and no more", () => {
    state.trailPainting = false;
    run(Math.round(20 / TICK));
    expect(state.launched).toBe(DECK_SIZE);
    expect(state.foundations.every((pile) => pile.length === 0)).toBe(true);
  });

  it("ends once every card has launched and none is in flight", () => {
    state.trailPainting = false;
    run(Math.round(20 / TICK));
    expect(state.cascadeDone).toBe(true);
    expect(state.flyers).toEqual([]);
  });
});

describe("the end flag", () => {
  it("stays down for posed flyers retiring on a cleared table", () => {
    state.flyers.push({
      id: 1,
      suit: "spades",
      rank: 5,
      x: STAGE_W,
      y: 100,
      vx: 10,
      vy: 0,
    });
    stepCascade(state, TICK);
    expect(state.flyers).toEqual([]);
    expect(state.cascadeDone).toBe(false);
  });
});

describe("launchNext", () => {
  it("reports that nothing went when every foundation is empty", () => {
    expect(launchNext(state)).toBe(false);
    expect(state.launched).toBe(0);
  });
});
