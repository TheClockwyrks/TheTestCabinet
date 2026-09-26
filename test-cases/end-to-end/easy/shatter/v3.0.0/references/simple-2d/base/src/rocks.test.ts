// The rocks: their radii, the size ladder, the fan, and star recycling.

import { describe, expect, it } from "vitest";
import {
  FIELD_H,
  FIELD_W,
  ROCK_RADIUS,
  ROCK_SPEED_MAX,
  ROCK_SPEED_MIN,
  SPLIT_KICK,
} from "./constants";
import { openingState } from "./flow";
import {
  addRock,
  drawBaseSpeed,
  recycleRock,
  rockRadius,
  spinRate,
  spinRocks,
  splitKickAcross,
  splitRock,
} from "./rocks";
import { toSim } from "./sim";

describe("a rock", () => {
  it("collides as the circle its size fixes", () => {
    expect(rockRadius("large")).toBe(ROCK_RADIUS.large);
    expect(rockRadius("medium")).toBe(ROCK_RADIUS.medium);
    expect(rockRadius("small")).toBe(ROCK_RADIUS.small);
  });

  it("is appended to the roster with a fresh id", () => {
    const sim = toSim(openingState());
    const first = addRock(sim, "large", 10, 20, 0, 0);
    const second = addRock(sim, "small", 30, 40, 0, 0);
    expect(sim.rocks).toEqual([first, second]);
    expect(first.id).not.toBe(second.id);
  });

  it("draws a base speed inside its size's range", () => {
    const sim = toSim(openingState());
    for (const size of ["large", "medium", "small"] as const) {
      for (let i = 0; i < 50; i += 1) {
        const speed = drawBaseSpeed(sim, size);
        expect(speed).toBeGreaterThanOrEqual(ROCK_SPEED_MIN[size]);
        expect(speed).toBeLessThanOrEqual(ROCK_SPEED_MAX[size]);
      }
    }
  });

  it("turns on the screen without its motion changing", () => {
    const sim = toSim(openingState());
    const rock = addRock(sim, "large", 100, 100, 40, -20);
    const before = rock.spin;
    spinRocks(sim, 0.5);
    expect(rock.spin).not.toBe(before);
    expect(rock.x).toBe(100);
    expect(rock.vx).toBe(40);
    expect(spinRate(rock.id)).not.toBe(0);
  });
});

describe("splitting", () => {
  it("leaves two of the size below, at the parent's position", () => {
    const sim = toSim(openingState());
    const parent = addRock(sim, "large", 300, 400, 20, -30);
    sim.rocks = [];
    splitRock(sim, parent, 0, SPLIT_KICK);

    expect(sim.rocks).toHaveLength(2);
    for (const fragment of sim.rocks) {
      expect(fragment.size).toBe("medium");
      expect(fragment.x).toBe(300);
      expect(fragment.y).toBe(400);
      expect(fragment.id).not.toBe(parent.id);
    }
    expect(sim.rocks[0].id).toBeLessThan(sim.rocks[1].id);
  });

  it("leaves nothing when a Small is destroyed", () => {
    const sim = toSim(openingState());
    const parent = addRock(sim, "small", 100, 100, 0, 0);
    sim.rocks = [];
    splitRock(sim, parent, 0, SPLIT_KICK);
    expect(sim.rocks).toHaveLength(0);
  });

  it("reads the parent's velocity off the pair, and the kick off their difference", () => {
    const sim = toSim(openingState());
    const parent = addRock(sim, "medium", 100, 100, -60, -60);
    sim.rocks = [];
    const [kx, ky] = splitKickAcross(800, 0);
    splitRock(sim, parent, kx, ky);

    const [a, b] = sim.rocks;
    expect((a.vx + b.vx) / 2).toBeCloseTo(parent.vx, 9);
    expect((a.vy + b.vy) / 2).toBeCloseTo(parent.vy, 9);
    expect(Math.hypot((a.vx - b.vx) / 2, (a.vy - b.vy) / 2)).toBeCloseTo(
      SPLIT_KICK,
      9,
    );
  });

  it("kicks across the round's travel rather than the rock's course", () => {
    // A horizontal shot fans its fragments vertically, whatever the rock did.
    const [kx, ky] = splitKickAcross(500, 0);
    expect(kx).toBeCloseTo(0, 9);
    expect(Math.abs(ky)).toBeCloseTo(SPLIT_KICK, 9);

    const [dx, dy] = splitKickAcross(0, -500);
    expect(Math.abs(dx)).toBeCloseTo(SPLIT_KICK, 9);
    expect(dy).toBeCloseTo(0, 9);
  });
});

describe("star recycling", () => {
  it("keeps the rock, its size and the count, and re-enters heading inward", () => {
    const sim = toSim(openingState());
    const rock = addRock(sim, "medium", 640, 360, 400, 0);
    const id = rock.id;

    const edges = new Set<string>();
    for (let i = 0; i < 60; i += 1) {
      recycleRock(sim, rock);
      expect(sim.rocks).toHaveLength(1);
      expect(rock.id).toBe(id);
      expect(rock.size).toBe("medium");

      const speed = Math.hypot(rock.vx, rock.vy);
      expect(speed).toBeGreaterThanOrEqual(ROCK_SPEED_MIN.medium);
      expect(speed).toBeLessThanOrEqual(ROCK_SPEED_MAX.medium);

      if (rock.x === 0) {
        edges.add("left");
        expect(rock.vx).toBeGreaterThan(0);
      } else if (rock.x === FIELD_W - 1) {
        edges.add("right");
        expect(rock.vx).toBeLessThan(0);
      } else if (rock.y === 0) {
        edges.add("top");
        expect(rock.vy).toBeGreaterThan(0);
      } else {
        expect(rock.y).toBe(FIELD_H - 1);
        edges.add("bottom");
        expect(rock.vy).toBeLessThan(0);
      }
    }
    expect(edges.size).toBe(4);
  });
});
