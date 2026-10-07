import { describe, expect, it } from "vitest";

import {
  collidingMotes,
  COLLISION_DISTANCE,
  firstCollisionSample,
  separation,
  type MotePoint,
} from "./collision";
import { COLLISION_SAMPLES } from "./constants";

/** One mote's center, written as the sampler reports it. */
function at(mote: number, x: number, y: number): MotePoint {
  return { mote, x, y };
}

describe("the collision threshold (specs/simulation.md)", () => {
  it("is twice MOTE_COLLIDE_R", () => {
    expect(COLLISION_DISTANCE).toBe(38);
  });

  it("samples eight fractions", () => {
    expect(COLLISION_SAMPLES).toBe(8);
  });

  it("measures the distance between two centers", () => {
    expect(separation({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe("which motes are within the threshold (specs/simulation.md)", () => {
  it("names nothing on a clear field", () => {
    expect(collidingMotes([at(1, 0, 0), at(2, 38, 0)])).toEqual([]);
  });

  it("is strict: exactly the threshold apart is clear", () => {
    expect(collidingMotes([at(1, 0, 0), at(2, COLLISION_DISTANCE, 0)])).toEqual(
      [],
    );
    expect(
      collidingMotes([at(1, 0, 0), at(2, COLLISION_DISTANCE - 0.001, 0)]),
    ).toEqual([1, 2]);
  });

  it("names every mote of every pair, in ascending id order", () => {
    expect(collidingMotes([at(7, 0, 0), at(3, 10, 0), at(9, 500, 0)])).toEqual([
      3, 7,
    ]);
  });

  it("checks every pair, so a third mote in reach is named too", () => {
    expect(collidingMotes([at(1, 0, 0), at(2, 20, 0), at(3, 40, 0)])).toEqual([
      1, 2, 3,
    ]);
  });
});

describe("the first sample within the threshold (specs/simulation.md)", () => {
  it("reports nothing when every sample is clear", () => {
    expect(firstCollisionSample(() => [at(1, 0, 0), at(2, 100, 0)])).toBeNull();
  });

  it("walks the samples in ascending order and stops at the first", () => {
    // Closing steadily: 8/8 is nearest, but 5/8 is the first within `38`.
    const sample = firstCollisionSample((t) => [
      at(1, 0, 0),
      at(2, 96 * (1 - t), 0),
    ]);
    expect(sample?.fraction).toBe(5 / COLLISION_SAMPLES);
    expect(sample?.motes).toEqual([1, 2]);
  });

  it("visits t = 1, so a move onto an occupied hex collides there", () => {
    const visited: number[] = [];
    const sample = firstCollisionSample((t) => {
      visited.push(t);
      return [at(1, 0, 0), at(2, t < 1 ? 100 : 0, 0)];
    });
    expect(visited).toEqual([
      1 / 8,
      2 / 8,
      3 / 8,
      4 / 8,
      5 / 8,
      6 / 8,
      7 / 8,
      1,
    ]);
    expect(sample?.fraction).toBe(1);
  });

  it("names every pair within the threshold at the sample it stops on", () => {
    const sample = firstCollisionSample(() => [
      at(4, 0, 0),
      at(1, 10, 0),
      at(2, 400, 0),
      at(3, 410, 0),
    ]);
    expect(sample?.motes).toEqual([1, 2, 3, 4]);
  });
});
