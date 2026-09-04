import { describe, expect, it } from "vitest";
import {
  BOUNCE_DAMP,
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
  STAGE_W,
  SUITS,
  TOP_ROW_Y,
} from "./constants";
import { advanceFlyer, nextFoundation, retired, stepCascade } from "./cascade";
import { makeCard } from "./deck";
import { openingState } from "./flow";
import { withPile } from "./piles";
import type { CascadeState, FlyerState } from "./game";

const STEP = 1 / 240;

let ids = 900;
function flyer(patch: Partial<FlyerState> = {}): FlyerState {
  return {
    id: ids++,
    suit: "spades",
    rank: 7,
    x: 600,
    y: 100,
    vx: 0,
    vy: 0,
    ...patch,
  };
}

function withFlyers(flyers: readonly FlyerState[]): CascadeState {
  return { ...openingState(), screen: "playing", flyers, launching: false };
}

function run(state: CascadeState, frames: number): CascadeState {
  let next = state;
  for (let i = 0; i < frames; i++) next = stepCascade(next, STEP).state;
  return next;
}

describe("a card in flight", () => {
  it("gains vertical speed at the stated gravity", () => {
    const start = flyer({ y: -2000, vy: 0 });
    const after = run(withFlyers([start]), 120);
    expect(after.flyers[0].vy).toBeCloseTo(GRAVITY * 0.5, 3);
  });

  it("advances by its horizontal velocity", () => {
    const start = flyer({ y: -4000, vx: 200 });
    const after = run(withFlyers([start]), 120);
    expect(after.flyers[0].x).toBeCloseTo(start.x + 200 * 0.5, 3);
  });

  it("advances by its vertical velocity over one frame", () => {
    const start = flyer({ y: 0, vy: 100 });
    const after = advanceFlyer(start, STEP);
    expect(after.vy).toBeCloseTo(100 + GRAVITY * STEP, 6);
    expect(after.y).toBeCloseTo(start.y + after.vy * STEP, 6);
  });

  it("bounces off the floor, damped, seated, and keeping its drift", () => {
    const start = flyer({ y: FLOOR_Y - 1, vy: 400, vx: 130 });
    const after = advanceFlyer(start, STEP);
    expect(after.y).toBe(FLOOR_Y);
    expect(after.vy).toBeLessThan(0);
    expect(Math.abs(after.vy)).toBeCloseTo(
      (400 + GRAVITY * STEP) * BOUNCE_DAMP,
      6,
    );
    expect(after.vx).toBe(130);
  });

  it("peaks lower with each bounce", () => {
    let state = withFlyers([flyer({ y: 100, vy: 0, vx: 0 })]);
    const peaks: number[] = [];
    let previous = 100;
    let rising = false;
    for (let i = 0; i < 2000 && peaks.length < 3; i++) {
      state = stepCascade(state, STEP).state;
      const y = state.flyers[0].y;
      if (y < previous) rising = true;
      else if (rising) {
        peaks.push(previous);
        rising = false;
      }
      previous = y;
    }
    expect(peaks).toHaveLength(3);
    expect(peaks[1]).toBeGreaterThan(peaks[0]);
    expect(peaks[2]).toBeGreaterThan(peaks[1]);
  });

  it("retires only once it has fully cleared a side edge", () => {
    expect(retired(flyer({ x: -CARD_W + 1 }))).toBe(false);
    expect(retired(flyer({ x: -CARD_W - 1 }))).toBe(true);
    expect(retired(flyer({ x: STAGE_W - 1 }))).toBe(false);
    expect(retired(flyer({ x: STAGE_W + 1 }))).toBe(true);

    const left = run(withFlyers([flyer({ x: -CARD_W + 2, vx: -300 })]), 10);
    expect(left.flyers).toHaveLength(0);
    const right = run(withFlyers([flyer({ x: STAGE_W - 2, vx: 300 })]), 10);
    expect(right.flyers).toHaveLength(0);
  });

  it("passes through another flyer without changing course", () => {
    const a = flyer({ x: 400, y: -3000, vx: 200 });
    const b = flyer({ x: 800, y: -3000, vx: -200 });
    const after = run(withFlyers([a, b]), 240);
    expect(after.flyers[0].vx).toBe(200);
    expect(after.flyers[1].vx).toBe(-200);
  });

  it("stamps the painted layer once per flyer per frame while the gate is on", () => {
    const painted = run(
      withFlyers([flyer({ y: -3000 }), flyer({ y: -3000 })]),
      10,
    );
    expect(painted.trailStamps).toBe(20);
    const gated = run(
      { ...withFlyers([flyer({ y: -3000 })]), trailPainting: false },
      10,
    );
    expect(gated.trailStamps).toBe(0);
    expect(gated.flyers[0].y).toBeGreaterThan(-3000);
  });
});

describe("the launch order", () => {
  it("cycles the foundations and skips one that has emptied", () => {
    const full = [makeCard(1, "spades", 1, true)];
    expect(nextFoundation([full, full, full, full], 0)).toBe(0);
    expect(nextFoundation([full, full, full, full], 5)).toBe(1);
    expect(nextFoundation([[], full, [], []], 0)).toBe(1);
    expect(nextFoundation([[], [], [], []], 0)).toBe(-1);
  });
});

describe("the cascade", () => {
  function won(): CascadeState {
    let state: CascadeState = {
      ...openingState(),
      screen: "won",
      launchClock: LAUNCH_INTERVAL,
      trailPainting: false,
    };
    for (let f = 0; f < 4; f++) {
      const cards = Array.from({ length: RANK_MAX }, (_, r) =>
        makeCard(f * 13 + r + 1, SUITS[f], r + 1, true),
      );
      state = withPile(state, "foundation", f, cards);
    }
    return state;
  }

  it("launches its first card on its first frame, from the anchor", () => {
    const outcome = stepCascade(won(), STEP);
    expect(outcome.state.launched).toBe(1);
    expect(outcome.cues).toEqual([CUES.launch]);
    const first = outcome.state.flyers[0];
    expect(first.x).toBe(FOUNDATION_X[0]);
    expect(first.y).toBe(TOP_ROW_Y);
    expect(first.vy).toBe(LAUNCH_VY);
    expect(Math.abs(first.vx)).toBeGreaterThanOrEqual(LAUNCH_VX_MIN);
    expect(Math.abs(first.vx)).toBeLessThan(LAUNCH_VX_MAX);
  });

  it("takes the top card of each foundation in turn", () => {
    const four = run(won(), 4 * Math.round(LAUNCH_INTERVAL * 240));
    expect(four.launched).toBe(4);
    expect(four.flyers.map((f) => f.suit)).toEqual([...SUITS]);
    expect(four.flyers.every((f) => f.rank === RANK_MAX)).toBe(true);
  });

  it("keeps the cadence, remainder and all", () => {
    const after = run(won(), 3 * 240);
    expect(after.launched).toBe(Math.floor(3 / LAUNCH_INTERVAL) + 1);
  });

  it("launches nothing while the gate is off", () => {
    const gated = run({ ...won(), launching: false }, 240);
    expect(gated.launched).toBe(0);
    expect(gated.flyers).toEqual([]);
  });

  it("launches every card, retires them all, and reports itself done", () => {
    const finished = run(won(), 240 * 20);
    expect(finished.launched).toBe(DECK_SIZE);
    expect(finished.flyers).toEqual([]);
    expect(finished.cascadeDone).toBe(true);
    expect(finished.foundations.every((f) => f.length === 0)).toBe(true);
  });

  it("draws both signs of horizontal speed over a whole cascade", () => {
    let state = won();
    const signs = new Set<number>();
    for (let i = 0; i < 240 * 20; i++) {
      const before = state.flyers.length;
      state = stepCascade(state, STEP).state;
      for (const flying of state.flyers.slice(before)) {
        signs.add(Math.sign(flying.vx));
      }
    }
    expect([...signs].sort()).toEqual([-1, 1]);
  });

  it("leaves cascadeDone alone on a table that never launched", () => {
    const posed = run(withFlyers([flyer({ x: STAGE_W - 2, vx: 300 })]), 10);
    expect(posed.flyers).toEqual([]);
    expect(posed.launched).toBe(0);
    expect(posed.cascadeDone).toBe(false);
  });
});
