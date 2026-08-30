import { afterEach, describe, expect, it } from "vitest";
import {
  ROCK_RADIUS,
  ROCK_SPEED_MAX,
  ROCK_SPEED_MIN,
  SCORE_LARGE,
  SCORE_MEDIUM,
  SCORE_SMALL,
  SPLIT_KICK,
  STAR_X,
  STAR_Y,
  type RockSize,
} from "./constants";
import { createHarness, poseRock, startPlaying, type Harness } from "./harness";
import { spinRate } from "./rocks";

let harness: Harness | null = null;

async function playing(): Promise<Harness> {
  harness = await createHarness();
  startPlaying(harness.debug);
  return harness;
}

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** Shoot one rock down with a round placed just short of it, and report. */
async function shootDown(
  h: Harness,
  size: RockSize,
  x: number,
  y: number,
  vx = 0,
  vy = 0,
): Promise<{
  parent: { vx: number; vy: number; x: number; y: number };
  round: { vx: number; vy: number };
  fragments: { vx: number; vy: number; x: number; y: number }[];
}> {
  poseRock(h.debug, size, x, y, vx, vy);
  const standoff = ROCK_RADIUS[size] + 40;
  h.debug.addBullet(x - standoff, y, 600, 0);

  let parent = { vx, vy, x, y };
  let round = { vx: 600, vy: 0 };
  for (let tick = 0; tick < 60; tick += 1) {
    const before = h.debug.snapshot();
    const rock = before.rocks[0];
    const bullet = before.bullets[0];
    if (rock !== undefined) parent = rock;
    if (bullet !== undefined) round = bullet;

    await h.advance(1);
    const after = h.debug.snapshot();
    if (after.rocks.some((entry) => entry.id === before.rocks[0]?.id)) continue;
    return { parent, round, fragments: after.rocks };
  }
  throw new Error("the round never landed");
}

describe("a rock's collision radius", () => {
  it.each([
    ["large" as RockSize, 44, 50],
    ["medium" as RockSize, 24, 30],
    ["small" as RockSize, 12, 18],
  ])("%s is hit at %d and missed at %d", async (size, hit, miss) => {
    const h = await playing();
    for (const [offset, survives] of [
      [hit, false],
      [miss, true],
    ] as const) {
      startPlaying(h.debug);
      h.debug.addRock(size, 300, 150);
      h.debug.addBullet(240, 150 - offset, 600, 0);
      await h.advance(24);
      const rocks = h.debug.snapshot().rocks;
      expect(rocks.some((rock) => rock.size === size)).toBe(survives);
    }
  });
});

describe("splitting", () => {
  it("a Large leaves two Medium and scores", async () => {
    const h = await playing();
    const { fragments } = await shootDown(h, "large", 300, 150);
    expect(fragments.length).toBe(2);
    expect(h.debug.snapshot().rocks.every((r) => r.size === "medium")).toBe(true);
    expect(h.debug.snapshot().score).toBe(SCORE_LARGE);
  });

  it("a Medium leaves two Small and scores", async () => {
    const h = await playing();
    const { fragments } = await shootDown(h, "medium", 300, 150);
    expect(fragments.length).toBe(2);
    expect(h.debug.snapshot().rocks.every((r) => r.size === "small")).toBe(true);
    expect(h.debug.snapshot().score).toBe(SCORE_MEDIUM);
  });

  it("a Small leaves nothing and scores", async () => {
    const h = await playing();
    const { fragments } = await shootDown(h, "small", 300, 150);
    expect(fragments.length).toBe(0);
    expect(h.debug.snapshot().score).toBe(SCORE_SMALL);
  });

  it("leaves both fragments where the parent died", async () => {
    const h = await playing();
    const { parent, fragments } = await shootDown(h, "large", 300, 150);
    for (const fragment of fragments) {
      expect(Math.hypot(fragment.x - parent.x, fragment.y - parent.y)).toBeLessThan(
        6,
      );
    }
  });

  it("carries the parent's motion and fans across the shot", async () => {
    const h = await playing();
    // The parent's own course is diagonal and the shot is horizontal, so a fan
    // taken from the rock's course and one taken from the round's differ.
    const { parent, round, fragments } = await shootDown(
      h,
      "medium",
      320,
      620,
      -60,
      -60,
    );
    expect(fragments).toHaveLength(2);

    const [first, second] = fragments;
    const meanX = (first.vx + second.vx) / 2;
    const meanY = (first.vy + second.vy) / 2;
    expect(Math.hypot(meanX - parent.vx, meanY - parent.vy)).toBeLessThan(10);

    const diffX = first.vx - second.vx;
    const diffY = first.vy - second.vy;
    expect(Math.hypot(diffX, diffY) / 2).toBeCloseTo(SPLIT_KICK, -1);
    expect(Math.abs(Math.hypot(diffX, diffY) / 2 - SPLIT_KICK)).toBeLessThan(9);

    // Perpendicular to the ROUND's travel rather than to the rock's course.
    const travel = Math.hypot(round.vx, round.vy);
    const along = (diffX * round.vx + diffY * round.vy) / travel;
    expect(Math.abs(along)).toBeLessThan(30);

    // The two fragments leave the average by opposite vectors.
    const bearing = (dx: number, dy: number): number => Math.atan2(dy, dx);
    const one = bearing(first.vx - meanX, first.vy - meanY);
    const other = bearing(second.vx - meanX, second.vy - meanY);
    const apart = Math.abs(
      Math.atan2(Math.sin(one - other), Math.cos(one - other)),
    );
    expect(Math.abs(apart - Math.PI)).toBeLessThan((5 * Math.PI) / 180);
  });
});

describe("how a rock moves", () => {
  it("passes through another rock", async () => {
    const h = await playing();
    const left = poseRock(h.debug, "large", 200, 120, 240, 0);
    const right = poseRock(h.debug, "large", 400, 120, -240, 0);
    await h.seconds(1);
    const rocks = h.debug.snapshot().rocks;
    expect(rocks.map((rock) => rock.id).sort()).toEqual([left, right].sort());
    // They have crossed, and neither velocity was turned by the crossing.
    expect(rocks.find((rock) => rock.id === left)!.vx).toBeGreaterThan(0);
    expect(rocks.find((rock) => rock.id === right)!.vx).toBeLessThan(0);
  });

  it("is bent by the well, and its spin moves it nowhere", async () => {
    const h = await playing();
    poseRock(h.debug, "medium", 200, 200);
    await h.seconds(1);

    const rock = h.debug.snapshot().rocks[0];
    const toStar = Math.atan2(STAR_Y - 200, STAR_X - 200);
    const travelled = Math.atan2(rock.y - 200, rock.x - 200);
    const heading = Math.atan2(rock.vy, rock.vx);
    const degree = Math.PI / 180;
    expect(Math.abs(travelled - toStar)).toBeLessThan(degree);
    expect(Math.abs(heading - toStar)).toBeLessThan(degree);
    expect(Math.hypot(rock.x - 200, rock.y - 200)).toBeGreaterThan(1);
    // Every rock still carries a drawn rotation, which nothing else reads.
    expect(Math.abs(spinRate(rock.id))).toBeGreaterThan(0);
  });

  it("wraps at every edge", async () => {
    const h = await playing();
    const runs: [number, number, number, number][] = [
      [8, 120, -300, 0],
      [1272, 120, 300, 0],
      [200, 8, 0, -300],
      [200, 712, 0, 300],
    ];
    for (const [x, y, vx, vy] of runs) {
      startPlaying(h.debug);
      poseRock(h.debug, "small", x, y, vx, vy);
      await h.advance(10);
      const rock = h.debug.snapshot().rocks[0];
      expect(rock.x).toBeGreaterThanOrEqual(0);
      expect(rock.x).toBeLessThan(1280);
      expect(rock.y).toBeGreaterThanOrEqual(0);
      expect(rock.y).toBeLessThan(720);
    }
  });
});

describe("the star recycling a rock", () => {
  /** Sling a rock into the core and report it the tick it re-enters. */
  async function recycle(
    h: Harness,
    size: RockSize,
    speed: number,
  ): Promise<{ x: number; y: number; vx: number; vy: number; size: RockSize }> {
    poseRock(h.debug, size, STAR_X - 320, STAR_Y, speed, 0);
    for (let tick = 0; tick < 400; tick += 1) {
      const before = h.debug.snapshot().rocks[0];
      await h.advance(1);
      const after = h.debug.snapshot().rocks[0];
      if (Math.hypot(after.x - before.x, after.y - before.y) > 40) return after;
    }
    throw new Error("the star never took the rock");
  }

  it("re-enters from an edge, heading into the field", async () => {
    const h = await playing();
    const rock = await recycle(h, "large", 300);
    const nearEdge =
      rock.x < 100 || rock.x > 1180 || rock.y < 100 || rock.y > 620;
    expect(nearEdge).toBe(true);

    if (rock.x < 100) expect(rock.vx).toBeGreaterThan(0);
    else if (rock.x > 1180) expect(rock.vx).toBeLessThan(0);
    else if (rock.y < 100) expect(rock.vy).toBeGreaterThan(0);
    else expect(rock.vy).toBeLessThan(0);
  });

  it("comes back the same size, at a fresh drift speed, scoring nothing", async () => {
    const h = await playing();
    const rock = await recycle(h, "large", 400);
    expect(rock.size).toBe("large");
    const speed = Math.hypot(rock.vx, rock.vy);
    expect(speed).toBeGreaterThanOrEqual(ROCK_SPEED_MIN.large - 2);
    expect(speed).toBeLessThanOrEqual(ROCK_SPEED_MAX.large + 2);
    expect(h.debug.snapshot().score).toBe(0);
  });

  it("leaves the field's rock count unchanged", async () => {
    const h = await playing();
    poseRock(h.debug, "medium", 900, 400, 0, 0);
    const before = h.debug.snapshot().rocks.length;
    await recycle(h, "small", 300);
    expect(h.debug.snapshot().rocks.length).toBe(before + 1);
  });

  it("gives a recycled Medium and Small a speed inside their own ranges", async () => {
    const h = await playing();
    for (const size of ["medium", "small"] as const) {
      startPlaying(h.debug);
      const rock = await recycle(h, size, 350);
      const speed = Math.hypot(rock.vx, rock.vy);
      expect(speed).toBeGreaterThanOrEqual(ROCK_SPEED_MIN[size] - 2);
      expect(speed).toBeLessThanOrEqual(ROCK_SPEED_MAX[size] + 2);
    }
  });
});
