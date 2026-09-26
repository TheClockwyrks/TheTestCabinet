// The victory cascade: the flight, the bounce, the cadence, and the end.

import { beforeEach, describe, expect, it } from "vitest";
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
  STAGE_W,
  TOP_ROW_Y,
} from "./constants";
import { advanceFlyers, nextLaunchFoundation, stepCascade } from "./cascade";
import { openingState } from "./flow";
import { takeId, toSim, type MutCard, type MutFlyer, type Sim } from "./sim";
import type { Suit } from "./game";

const STEP = 1 / 240;

function newSim(): Sim {
  const sim = toSim(openingState());
  sim.trailPainting = false;
  return sim;
}

function addFlyer(sim: Sim, patch: Partial<MutFlyer> = {}): MutFlyer {
  const flyer: MutFlyer = {
    id: takeId(sim),
    suit: "spades",
    rank: 1,
    x: 600,
    y: 200,
    vx: 0,
    vy: 0,
    ...patch,
  };
  sim.flyers.push(flyer);
  return flyer;
}

function fillFoundations(sim: Sim): void {
  const suits: Suit[] = ["spades", "hearts", "diamonds", "clubs"];
  suits.forEach((suit, index) => {
    const pile: MutCard[] = [];
    for (let rank = 1; rank <= 13; rank++) {
      pile.push({ id: takeId(sim), suit, rank, faceUp: true });
    }
    sim.foundations[index] = pile;
  });
}

function run(sim: Sim, seconds: number, step = STEP): void {
  const frames = Math.round(seconds / step);
  for (let i = 0; i < frames; i++) stepCascade(sim, step);
}

let sim: Sim;
beforeEach(() => {
  sim = newSim();
});

describe("a card in flight", () => {
  it("accelerates downward at the stated gravity", () => {
    const flyer = addFlyer(sim, { vy: -120 });
    run(sim, 0.5);
    expect(flyer.vy).toBeCloseTo(-120 + GRAVITY * 0.5, 1);
  });

  it("advances along x by its horizontal velocity", () => {
    const flyer = addFlyer(sim, { x: 300, y: -4000, vx: 200, vy: 0 });
    run(sim, 0.5);
    expect(flyer.x).toBeCloseTo(300 + 200 * 0.5, 1);
  });

  it("advances along y by the velocity gravity just gave it", () => {
    const flyer = addFlyer(sim, { y: 100, vy: 0 });
    advanceFlyers(sim, STEP);
    expect(flyer.y).toBeCloseTo(100 + GRAVITY * STEP * STEP, 6);
  });

  it("bounces off the floor, damped, seated, and keeping its drift", () => {
    const flyer = addFlyer(sim, { x: 400, y: FLOOR_Y - 60, vx: 90, vy: 400 });
    let incoming = flyer.vy;
    for (let i = 0; i < 400; i++) {
      const before = flyer.vy;
      advanceFlyers(sim, STEP);
      if (flyer.vy < 0) {
        incoming = before + GRAVITY * STEP;
        break;
      }
    }
    expect(flyer.vy).toBeLessThan(0);
    expect(Math.abs(flyer.vy)).toBeCloseTo(incoming * BOUNCE_DAMP, 4);
    expect(flyer.y).toBe(FLOOR_Y);
    expect(flyer.vx).toBe(90);
  });

  it("peaks lower on each successive bounce", () => {
    const flyer = addFlyer(sim, { x: 400, y: FLOOR_Y, vx: 0, vy: 900 });
    const peaks: number[] = [];
    let rising = false;
    let peak = flyer.y;
    for (let i = 0; i < 2000 && peaks.length < 3; i++) {
      advanceFlyers(sim, STEP);
      if (flyer.vy < 0) {
        rising = true;
        peak = Math.min(peak, flyer.y);
      } else if (rising) {
        peaks.push(peak);
        rising = false;
        peak = flyer.y;
      }
    }
    expect(peaks).toHaveLength(3);
    expect(peaks[1] as number).toBeGreaterThan(peaks[0] as number);
    expect(peaks[2] as number).toBeGreaterThan(peaks[1] as number);
  });

  it("crosses a side edge rather than turning at it", () => {
    const flyer = addFlyer(sim, { x: 40, y: 200, vx: -600, vy: 0 });
    advanceFlyers(sim, STEP);
    expect(flyer.vx).toBe(-600);
    expect(flyer.x).toBeLessThan(40);
  });

  it("passes through another card in flight", () => {
    const a = addFlyer(sim, { x: 500, y: 300, vx: 300, vy: 0 });
    const b = addFlyer(sim, { x: 520, y: 300, vx: -300, vy: 0 });
    run(sim, 0.2);
    expect(a.vx).toBe(300);
    expect(b.vx).toBe(-300);
  });

  it("retires past either side edge and not before", () => {
    addFlyer(sim, { x: -CARD_W + 1, y: 200, vx: -10, vy: 0 });
    addFlyer(sim, { x: STAGE_W - 1, y: 200, vx: 10, vy: 0 });
    expect(sim.flyers).toHaveLength(2);
    advanceFlyers(sim, 0.5);
    expect(sim.flyers).toHaveLength(0);
  });

  it("stays in flight while it is still over the table", () => {
    addFlyer(sim, { x: -CARD_W + 20, y: 200, vx: 0, vy: 0 });
    advanceFlyers(sim, STEP);
    expect(sim.flyers).toHaveLength(1);
  });
});

describe("the painted layer", () => {
  it("counts one stamp per card in flight per frame while painting is on", () => {
    sim.trailPainting = true;
    addFlyer(sim);
    addFlyer(sim);
    advanceFlyers(sim, STEP);
    expect(sim.trailStamps).toBe(2);
    advanceFlyers(sim, STEP);
    expect(sim.trailStamps).toBe(4);
  });

  it("takes no stamp while painting is gated off", () => {
    addFlyer(sim);
    advanceFlyers(sim, STEP);
    expect(sim.trailStamps).toBe(0);
    expect(sim.flyers[0]?.y).toBeGreaterThan(200);
  });
});

describe("the launch clock", () => {
  beforeEach(() => {
    fillFoundations(sim);
    sim.screen = "won";
    sim.launchClock = LAUNCH_INTERVAL;
  });

  it("launches the first card on the cascade's first frame", () => {
    stepCascade(sim, STEP);
    expect(sim.launched).toBe(1);
    const flyer = sim.flyers[0] as MutFlyer;
    expect(flyer.x).toBe(FOUNDATION_X[0] as number);
    expect(flyer.y).toBe(TOP_ROW_Y);
    expect(flyer.vy).toBe(LAUNCH_VY);
    expect(sim.pendingCues).toContain(CUES.launch);
  });

  it("keeps the cadence over three seconds, carrying the remainder", () => {
    const times: number[] = [];
    let elapsed = 0;
    let seen = 0;
    for (let i = 0; i < Math.round(3 / STEP); i++) {
      stepCascade(sim, STEP);
      elapsed += STEP;
      while (seen < sim.launched) {
        times.push(elapsed);
        seen++;
      }
    }
    expect(sim.launched).toBe(Math.floor(3 / LAUNCH_INTERVAL) + 1);
    const gaps = times.slice(1).map((t, i) => t - (times[i] as number));
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(mean).toBeCloseTo(LAUNCH_INTERVAL, 3);
  });

  it("cycles the four foundations, taking each one's top card", () => {
    const kings: number[] = sim.foundations.map(
      (pile) => (pile[pile.length - 1] as MutCard).id,
    );
    for (let i = 0; i < 4; i++) {
      sim.launchClock = LAUNCH_INTERVAL;
      stepCascade(sim, STEP);
    }
    expect(sim.launched).toBe(4);
    expect(sim.flyers.map((f) => f.id)).toEqual(kings);
    expect(sim.foundations.map((p) => p.length)).toEqual([12, 12, 12, 12]);
  });

  it("skips a foundation that has been emptied", () => {
    sim.foundations[1] = [];
    sim.foundations[2] = [];
    sim.launched = 1;
    sim.launchClock = LAUNCH_INTERVAL;
    stepCascade(sim, STEP);
    expect(nextLaunchFoundation(sim)).not.toBeNull();
    expect((sim.foundations[3] as MutCard[]).length).toBe(12);
  });

  it("draws every launch's horizontal speed from the stated range, both ways", () => {
    const signs = new Set<number>();
    const seen = new Set<number>();
    for (let i = 0; i < Math.round(12 / STEP); i++) {
      stepCascade(sim, STEP);
      for (const flyer of sim.flyers) {
        if (seen.has(flyer.id)) continue;
        seen.add(flyer.id);
        expect(Math.abs(flyer.vx)).toBeGreaterThanOrEqual(LAUNCH_VX_MIN);
        expect(Math.abs(flyer.vx)).toBeLessThan(LAUNCH_VX_MAX);
        signs.add(Math.sign(flyer.vx));
      }
    }
    expect(seen.size).toBe(DECK_SIZE);
    expect(signs.size).toBe(2);
  });

  it("stops launching while the gate is off, and keeps the flight moving", () => {
    sim.launching = false;
    const flyer = addFlyer(sim, { vx: 100 });
    run(sim, 1);
    expect(sim.launched).toBe(0);
    expect(flyer.x).toBeCloseTo(700, 1);
  });

  it("is done once every card has launched and none is in flight", () => {
    run(sim, 30);
    expect(sim.launched).toBe(DECK_SIZE);
    expect(sim.flyers).toHaveLength(0);
    expect(sim.cascadeDone).toBe(true);
  });

  it("is not done by posed flyers retiring on a cleared table", () => {
    const bare = newSim();
    bare.screen = "playing";
    addFlyer(bare, { x: STAGE_W - 1, vx: 400 });
    run(bare, 1);
    expect(bare.flyers).toHaveLength(0);
    expect(bare.cascadeDone).toBe(false);
  });

  it("draws each cascade's launch velocities afresh", () => {
    const other = newSim();
    fillFoundations(other);
    other.screen = "won";
    other.launchClock = LAUNCH_INTERVAL;
    run(sim, 4);
    run(other, 4);
    expect(other.flyers.map((f) => f.vx)).not.toEqual(
      sim.flyers.map((f) => f.vx),
    );
  });
});
