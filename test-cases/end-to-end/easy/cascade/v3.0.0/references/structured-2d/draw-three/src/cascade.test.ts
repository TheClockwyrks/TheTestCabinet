import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BOUNCE_DAMP,
  CARD_W,
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
import {
  createHarness,
  openTable,
  startCascade,
  type Harness,
} from "./harness";

/** The fine frame every timing scenario advances in. */
const FINE_MS = 1000 / 240;
const FINE_DT = FINE_MS / 1000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  openTable(h);
});

afterEach(() => {
  h.dispose();
});

describe("the launch clock", () => {
  it("launches the first card on the cascade's first frame", async () => {
    expect(startCascade(h)).toBe(true);
    expect(h.debug.snapshot().flyers).toHaveLength(0);
    await h.advance(1);
    expect(h.debug.snapshot().flyers).toHaveLength(1);
    expect(h.debug.snapshot().launched).toBe(1);
  });

  it("launches one card every interval, carrying its remainder", async () => {
    h.debug.setTrailPainting(false);
    startCascade(h);
    h.setStep(FINE_MS);
    await h.advance(Math.round(3 / FINE_DT));
    expect(h.debug.snapshot().launched).toBe(
      Math.floor(3 / LAUNCH_INTERVAL) + 1,
    );
  });

  it("cycles the four foundations, taking each one's top card in turn", async () => {
    h.debug.setTrailPainting(false);
    startCascade(h);
    const before = h.debug.snapshot().foundations.map((pile) => pile.length);
    h.setStep(FINE_MS);
    await h.advance(Math.round((LAUNCH_INTERVAL * 3.5) / FINE_DT));
    const after = h.debug.snapshot().foundations.map((pile) => pile.length);
    expect(h.debug.snapshot().launched).toBe(4);
    expect(after).toEqual(before.map((count) => count - 1));
  });

  it("walks a foundation from its King down to its Ace", async () => {
    h.debug.setTrailPainting(false);
    startCascade(h);
    h.setStep(FINE_MS);
    const ranks: number[] = [];
    let seen = 0;
    for (let i = 0; i < Math.round(2 / FINE_DT); i += 1) {
      await h.advance(1);
      const shot = h.debug.snapshot();
      if (shot.launched > seen) {
        ranks.push(shot.flyers[shot.flyers.length - 1].rank);
        seen = shot.launched;
      }
    }
    // Every fourth launch is the same foundation's, one rank lower each time.
    expect(ranks[0]).toBe(13);
    expect(ranks[4]).toBe(12);
    expect(ranks[8]).toBe(11);
  });

  it("launches from the foundation's own anchor, popping upward", async () => {
    startCascade(h);
    await h.advance(1);
    const [flyer] = h.debug.snapshot().flyers;
    expect(flyer.x).toBe(FOUNDATION_X[0]);
    expect(flyer.y).toBe(TOP_ROW_Y);
    expect(flyer.vy).toBe(LAUNCH_VY);
  });

  it("draws every horizontal speed from the stated range, in both signs", async () => {
    h.debug.setTrailPainting(false);
    startCascade(h);
    h.setStep(FINE_MS);
    const signs = new Set<number>();
    let seen = 0;
    for (let i = 0; i < Math.round(12 / FINE_DT); i += 1) {
      await h.advance(1);
      const shot = h.debug.snapshot();
      if (shot.launched > seen) {
        for (const flyer of shot.flyers) {
          expect(Math.abs(flyer.vx)).toBeGreaterThanOrEqual(LAUNCH_VX_MIN);
          expect(Math.abs(flyer.vx)).toBeLessThanOrEqual(LAUNCH_VX_MAX);
          signs.add(Math.sign(flyer.vx));
        }
        seen = shot.launched;
      }
      if (seen >= DECK_SIZE) break;
    }
    expect(seen).toBe(DECK_SIZE);
    expect([...signs].sort()).toEqual([-1, 1]);
  });

  it("launches nothing further while the gate is off, and keeps flyers moving", async () => {
    startCascade(h);
    await h.advance(1);
    const before = h.debug.snapshot();
    h.debug.setLaunching(false);
    await h.advance(60);
    const after = h.debug.snapshot();
    expect(after.launched).toBe(before.launched);
    expect(after.flyers[0].y).not.toBe(before.flyers[0].y);
  });
});

describe("a card in flight", () => {
  beforeEach(() => {
    h.debug.setTrailPainting(false);
    h.setStep(FINE_MS);
  });

  it("accelerates downward at the stated gravity", async () => {
    h.debug.addFlyer("hearts", 5, 400, 0, 0, 0);
    const frames = Math.round(0.5 / FINE_DT);
    await h.advance(frames);
    expect(h.debug.snapshot().flyers[0].vy).toBeCloseTo(GRAVITY * 0.5, 6);
  });

  it("advances by its horizontal velocity, which gravity never touches", async () => {
    h.debug.addFlyer("hearts", 5, 400, 0, 200, 0);
    await h.advance(Math.round(0.5 / FINE_DT));
    const flyer = h.debug.snapshot().flyers[0];
    expect(flyer.x).toBeCloseTo(400 + 200 * 0.5, 6);
    expect(flyer.vx).toBe(200);
  });

  it("advances by its post-gravity vertical velocity each frame", async () => {
    h.debug.addFlyer("hearts", 5, 400, 100, 0, 60);
    await h.advance(1);
    const flyer = h.debug.snapshot().flyers[0];
    const vy = 60 + GRAVITY * FINE_DT;
    expect(flyer.vy).toBeCloseTo(vy, 9);
    expect(flyer.y).toBeCloseTo(100 + vy * FINE_DT, 9);
  });

  it("bounces off the floor, seated on it, keeping four fifths of its speed", async () => {
    h.debug.addFlyer("hearts", 5, 400, FLOOR_Y - 2, 150, 900);
    await h.advance(1);
    const flyer = h.debug.snapshot().flyers[0];
    const incoming = 900 + GRAVITY * FINE_DT;
    expect(flyer.y).toBe(FLOOR_Y);
    expect(flyer.vy).toBeCloseTo(-incoming * BOUNCE_DAMP, 6);
    expect(flyer.vx).toBe(150);
  });

  it("peaks lower with every bounce", async () => {
    h.debug.addFlyer("hearts", 5, 400, FLOOR_Y - 1, 0, 900);
    const peaks: number[] = [];
    let lowest = Number.POSITIVE_INFINITY;
    let rising = false;
    for (let i = 0; i < Math.round(4 / FINE_DT) && peaks.length < 3; i += 1) {
      await h.advance(1);
      const flyer = h.debug.snapshot().flyers[0];
      if (flyer === undefined) break;
      if (flyer.vy < 0) {
        rising = true;
        lowest = Math.min(lowest, flyer.y);
      } else if (rising) {
        peaks.push(lowest);
        rising = false;
        lowest = Number.POSITIVE_INFINITY;
      }
    }
    expect(peaks).toHaveLength(3);
    expect(peaks[1]).toBeGreaterThan(peaks[0]);
    expect(peaks[2]).toBeGreaterThan(peaks[1]);
  });

  it("crosses a side edge rather than turning at it", async () => {
    h.debug.addFlyer("hearts", 5, STAGE_W - 140, 100, 600, -600);
    await h.advance(2);
    const flyer = h.debug.snapshot().flyers[0];
    expect(flyer.x).toBeGreaterThan(STAGE_W - 140);
    expect(flyer.vx).toBe(600);
  });

  it("passes through another card in flight", async () => {
    h.debug.addFlyer("hearts", 5, 600, 300, 400, 0);
    h.debug.addFlyer("spades", 5, 620, 300, -400, 0);
    await h.advance(Math.round(0.2 / FINE_DT));
    const [left, right] = h.debug.snapshot().flyers;
    expect(left.vx).toBe(400);
    expect(right.vx).toBe(-400);
    expect(left.x).toBeGreaterThan(right.x);
  });

  it("retires once it has cleared either side edge", async () => {
    h.debug.addFlyer("hearts", 5, 20, 100, -900, -900);
    h.debug.addFlyer("spades", 5, STAGE_W - 120, 100, 900, -900);
    await h.advance(Math.round(1 / FINE_DT));
    expect(h.debug.snapshot().flyers).toHaveLength(0);
  });

  it("stays in flight while it is still partly on the table", async () => {
    h.debug.addFlyer("hearts", 5, -CARD_W + 10, 100, 0, -400);
    await h.advance(1);
    expect(h.debug.snapshot().flyers).toHaveLength(1);
  });
});

describe("the painted layer", () => {
  it("takes one stamp per card in flight per frame", async () => {
    h.debug.addFlyer("hearts", 5, 400, 100, 0, -200);
    h.debug.addFlyer("spades", 5, 500, 100, 0, -200);
    await h.advance(10);
    expect(h.debug.snapshot().trailStamps).toBe(20);
  });

  it("stops rising while the gate is off, and the flyer still moves", async () => {
    h.debug.addFlyer("hearts", 5, 400, 100, 0, -200);
    await h.advance(5);
    const before = h.debug.snapshot();
    h.debug.setTrailPainting(false);
    await h.advance(5);
    const after = h.debug.snapshot();
    expect(after.trailStamps).toBe(before.trailStamps);
    expect(after.flyers[0].y).not.toBe(before.flyers[0].y);
  });

  it("is emptied by clearTrail, leaving every flyer in flight", async () => {
    h.debug.addFlyer("hearts", 5, 400, 100, 0, -200);
    await h.advance(5);
    expect(h.debug.snapshot().trailStamps).toBeGreaterThan(0);
    h.debug.clearTrail();
    expect(h.debug.snapshot().trailStamps).toBe(0);
    expect(h.debug.snapshot().flyers).toHaveLength(1);
  });
});

describe("the end of the cascade", () => {
  it("launches every card, retires every one, and reports itself done", async () => {
    h.debug.setTrailPainting(false);
    startCascade(h);
    for (let i = 0; i < 60 && !h.debug.snapshot().cascadeDone; i += 1) {
      await h.advance(30);
    }
    const shot = h.debug.snapshot();
    expect(shot.launched).toBe(DECK_SIZE);
    expect(shot.flyers).toHaveLength(0);
    expect(shot.cascadeDone).toBe(true);
    expect(shot.foundations.flat()).toHaveLength(0);
  });

  it("is never set by flyers posed onto a cleared table", async () => {
    h.debug.addFlyer("hearts", 5, 20, 100, -900, -900);
    await h.advance(60);
    const shot = h.debug.snapshot();
    expect(shot.flyers).toHaveLength(0);
    expect(shot.launched).toBe(0);
    expect(shot.cascadeDone).toBe(false);
  });

  it("replays exactly from one seed", async () => {
    const run = async (): Promise<string> => {
      openTable(h);
      h.debug.reset({ seed: 9 });
      h.debug.setScreen("playing");
      h.debug.clearTable();
      h.debug.setTrailPainting(false);
      startCascade(h);
      await h.advance(120);
      return JSON.stringify(h.debug.snapshot().flyers);
    };
    const first = await run();
    const second = await run();
    expect(second).toBe(first);
  });
});
