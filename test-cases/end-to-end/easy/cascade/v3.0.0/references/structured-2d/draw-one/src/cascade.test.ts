// The victory cascade: the cadence, the arcs, the bounces, the trail and the
// ending (specs/victory.md).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BOUNCE_DAMP,
  CARD_H,
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
import { createHarness, openTable, poseNearlyWon, type Harness } from "./harness";
import { COLOR, rgbOf } from "./theme";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** A won game whose cascade is about to run, with the trail's painting off. */
function startCascade(h: Harness, seed = 1): void {
  const { debug } = h;
  debug.reset({ seed });
  debug.setScreen("playing");
  debug.clearTable();
  poseNearlyWon(debug);
  debug.setTrailPainting(false);
  debug.move("tableau", 0, 0, "foundation", 3);
}

/** One flyer alone on a cleared table, with nothing else launching. */
function onlyFlyer(
  h: Harness,
  x: number,
  y: number,
  vx: number,
  vy: number,
): number {
  const { debug } = h;
  openTable(debug);
  debug.setLaunching(false);
  debug.setTrailPainting(false);
  debug.addFlyer("spades", 7, x, y, vx, vy);
  return debug.snapshot().flyers[0].id;
}

function distance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe("the launch", () => {
  it("begins with the win, on the cascade's first frame", async () => {
    const { debug } = h;
    startCascade(h);
    expect(debug.snapshot().screen).toBe("won");
    expect(debug.snapshot().launchClock).toBeCloseTo(LAUNCH_INTERVAL, 10);
    expect(debug.snapshot().launched).toBe(0);
    await h.advance(1);
    expect(debug.snapshot().launched).toBe(1);
  });

  it("launches a card every interval, without drifting", async () => {
    const { debug } = h;
    startCascade(h);
    const step = 1 / 240;
    const times: number[] = [];
    let launched = 0;
    for (let frame = 0; frame < 720; frame += 1) {
      await h.seconds(step, step);
      const shot = debug.snapshot();
      while (launched < shot.launched) {
        times.push(shot.simTime);
        launched += 1;
      }
    }
    expect(times).toHaveLength(Math.floor(3 / LAUNCH_INTERVAL) + 1);
    const mean = (times[times.length - 1] - times[0]) / (times.length - 1);
    expect(mean).toBeCloseTo(LAUNCH_INTERVAL, 3);
    expect(Math.abs(mean - LAUNCH_INTERVAL) / LAUNCH_INTERVAL).toBeLessThan(0.02);
  });

  it("cycles the four foundations and walks each one King down to Ace", async () => {
    const { debug } = h;
    startCascade(h);
    const from: number[] = [];
    const ranks: number[] = [];
    let seen = 0;
    let sizes = debug.snapshot().foundations.map((pile) => pile.length);
    for (let frame = 0; frame < 400 && from.length < 8; frame += 1) {
      await h.seconds(1 / 240, 1 / 240);
      const shot = debug.snapshot();
      if (shot.launched === seen) continue;
      seen = shot.launched;
      const next = shot.foundations.map((pile) => pile.length);
      const index = next.findIndex((size, i) => size < sizes[i]);
      from.push(index);
      ranks.push(shot.flyers[shot.flyers.length - 1].rank);
      sizes = next;
    }
    expect(from.slice(0, 4)).toEqual([0, 1, 2, 3]);
    expect(from.slice(4, 8)).toEqual([0, 1, 2, 3]);
    // Each foundation gives up its own top card, so its second launch is the
    // rank below its first.
    for (let i = 0; i < 4; i += 1) {
      expect(ranks[i + 4]).toBe(ranks[i] - 1);
    }
  });

  it("launches from the foundation's anchor, upward, at a speed in range", async () => {
    const { debug } = h;
    startCascade(h);
    await h.advance(1);
    const first = debug.snapshot().flyers[0];
    expect(first.x).toBe(FOUNDATION_X[0]);
    expect(first.y).toBe(TOP_ROW_Y);
    expect(first.vy).toBe(LAUNCH_VY);
    expect(Math.abs(first.vx)).toBeGreaterThanOrEqual(LAUNCH_VX_MIN);
    expect(Math.abs(first.vx)).toBeLessThanOrEqual(LAUNCH_VX_MAX);
  });

  it("sends cards to both sides over a whole cascade", async () => {
    const { debug } = h;
    startCascade(h, 3);
    const signs = new Set<number>();
    let seen = 0;
    for (let frame = 0; frame < 700 && signs.size < 2; frame += 1) {
      await h.seconds(1 / 120, 1 / 120);
      const shot = debug.snapshot();
      if (shot.launched === seen) continue;
      seen = shot.launched;
      for (const flyer of shot.flyers) signs.add(Math.sign(flyer.vx));
    }
    expect([...signs].sort()).toEqual([-1, 1]);
  });
});

describe("a card in flight", () => {
  it("accelerates downward at gravity and advances by its velocity", async () => {
    const { debug } = h;
    const id = onlyFlyer(h, 400, 100, 200, 0);
    const before = debug.snapshot().flyers[0];
    await h.seconds(0.5, 1 / 240);
    const after = debug.snapshot().flyers.find((f) => f.id === id);
    expect(after).toBeDefined();
    expect(after!.vy - before.vy).toBeCloseTo(GRAVITY * 0.5, 2);
    expect(after!.x - before.x).toBeCloseTo(200 * 0.5, 2);
  });

  it("advances y by the velocity gravity has just given it", async () => {
    const { debug } = h;
    onlyFlyer(h, 400, 100, 0, 0);
    const dt = 1 / 240;
    await h.seconds(dt, dt);
    const flyer = debug.snapshot().flyers[0];
    expect(flyer.vy).toBeCloseTo(GRAVITY * dt, 6);
    expect(flyer.y).toBeCloseTo(100 + GRAVITY * dt * dt, 6);
  });

  it("bounces off the floor, damped, seated, and keeping its drift", async () => {
    const { debug } = h;
    const dt = 1 / 240;
    onlyFlyer(h, 400, FLOOR_Y - 60, 150, 400);
    for (let frame = 0; frame < 240; frame += 1) {
      const before = debug.snapshot().flyers[0];
      await h.seconds(dt, dt);
      const after = debug.snapshot().flyers[0];
      if (after.vy >= 0) continue;
      // The speed the bounce reflected is the one gravity had just given it.
      const incoming = before.vy + GRAVITY * dt;
      expect(after.y).toBeCloseTo(FLOOR_Y, 6);
      expect(Math.abs(after.vy)).toBeCloseTo(incoming * BOUNCE_DAMP, 6);
      expect(after.vx).toBe(before.vx);
      return;
    }
    throw new Error("the flyer never reached the floor");
  });

  it("peaks lower with every bounce", async () => {
    const { debug } = h;
    onlyFlyer(h, 400, FLOOR_Y - 10, 40, 600);
    const peaks: number[] = [];
    let rising = false;
    let highest = FLOOR_Y;
    for (let frame = 0; frame < 2000 && peaks.length < 3; frame += 1) {
      await h.seconds(1 / 240, 1 / 240);
      const flyer = debug.snapshot().flyers[0];
      if (flyer === undefined) break;
      if (flyer.vy < 0) {
        rising = true;
        highest = Math.min(highest, flyer.y);
      } else if (rising) {
        peaks.push(highest);
        rising = false;
        highest = FLOOR_Y;
      }
    }
    expect(peaks).toHaveLength(3);
    expect(peaks[1]).toBeGreaterThan(peaks[0]);
    expect(peaks[2]).toBeGreaterThan(peaks[1]);
  });

  it("collides with nothing: not a side edge, not another card", async () => {
    const { debug } = h;
    openTable(debug);
    debug.setLaunching(false);
    debug.setTrailPainting(false);
    debug.addFlyer("spades", 7, 60, 300, -200, 0);
    await h.seconds(0.2, 1 / 240);
    const left = debug.snapshot().flyers[0];
    expect(left.vx).toBe(-200);
    expect(left.x).toBeLessThan(60);

    openTable(debug);
    debug.setLaunching(false);
    debug.setTrailPainting(false);
    debug.addFlyer("spades", 7, 500, 300, 300, 0);
    debug.addFlyer("hearts", 7, 700, 300, -300, 0);
    await h.seconds(0.5, 1 / 240);
    const both = debug.snapshot().flyers;
    expect(both.map((f) => f.vx)).toEqual([300, -300]);
  });

  it("retires past either side edge and not before", async () => {
    const { debug } = h;
    onlyFlyer(h, STAGE_W - CARD_W - 10, 300, 400, 0);
    await h.seconds(0.05, 1 / 240);
    expect(debug.snapshot().flyers).toHaveLength(1);
    await h.seconds(1, 1 / 240);
    expect(debug.snapshot().flyers).toHaveLength(0);

    onlyFlyer(h, 10, 300, -400, 0);
    await h.seconds(0.05, 1 / 240);
    expect(debug.snapshot().flyers).toHaveLength(1);
    await h.seconds(1, 1 / 240);
    expect(debug.snapshot().flyers).toHaveLength(0);
  });
});

describe("the painted trail", () => {
  it("keeps a stamp long after the card has moved on", async () => {
    const { debug } = h;
    openTable(debug);
    debug.setLaunching(false);
    debug.addFlyer("clubs", 7, 700, 380, 600, 0);
    await h.advance(1);
    const stamped = debug.snapshot().flyers[0];
    const at: [number, number] = [stamped.x + CARD_W / 2, stamped.y + CARD_H / 2];
    await h.advance(40);
    expect(debug.snapshot().trailStamps).toBeGreaterThan(1);
    expect(distance(h.pixel(...at), rgbOf(COLOR.felt))).toBeGreaterThan(60);
  });

  it("buries more of the table the longer the cascade runs", async () => {
    const { debug } = h;
    const painted = async (seconds: number): Promise<number> => {
      debug.reset({ seed: 2 });
      debug.setScreen("playing");
      debug.clearTable();
      poseNearlyWon(debug);
      debug.move("tableau", 0, 0, "foundation", 3);
      await h.seconds(seconds, 1 / 120);
      let count = 0;
      for (let x = 20; x < STAGE_W; x += 40) {
        for (let y = 340; y < 700; y += 40) {
          if (distance(h.pixel(x, y), rgbOf(COLOR.felt)) > 60) count += 1;
        }
      }
      return count;
    };
    const early = await painted(1);
    const later = await painted(4);
    expect(later).toBeGreaterThan(early);
  });
});

describe("the end of the cascade", () => {
  it("launches every card, retires every card, and stays painted", async () => {
    const { debug } = h;
    debug.reset({ seed: 4 });
    debug.setScreen("playing");
    debug.clearTable();
    poseNearlyWon(debug);
    debug.move("tableau", 0, 0, "foundation", 3);

    for (let block = 0; block < 60 && !debug.snapshot().cascadeDone; block += 1) {
      await h.seconds(0.5, 1 / 120);
    }
    const shot = debug.snapshot();
    expect(shot.launched).toBe(DECK_SIZE);
    expect(shot.flyers).toHaveLength(0);
    expect(shot.cascadeDone).toBe(true);
    expect(shot.foundations.flat()).toHaveLength(0);
    expect(shot.trailStamps).toBeGreaterThan(0);

    // The table is still buried once the last flyer has gone.
    let painted = 0;
    for (let x = 20; x < STAGE_W; x += 40) {
      if (distance(h.pixel(x, FLOOR_Y + CARD_H / 2), rgbOf(COLOR.felt)) > 60) {
        painted += 1;
      }
    }
    expect(painted).toBeGreaterThan(8);
  }, 60000);

  it("keeps the unlaunched cards drawn at their foundation anchors", async () => {
    const { debug } = h;
    startCascade(h);
    await h.seconds(0.5, 1 / 240);
    const shot = debug.snapshot();
    expect(shot.foundations.flat().length).toBeGreaterThan(0);
    const held = shot.foundations.findIndex((pile) => pile.length > 0);
    const at: [number, number] = [
      FOUNDATION_X[held] + CARD_W / 2,
      TOP_ROW_Y + CARD_H / 2,
    ];
    expect(distance(h.pixel(...at), rgbOf(COLOR.felt))).toBeGreaterThan(60);
  });
});
