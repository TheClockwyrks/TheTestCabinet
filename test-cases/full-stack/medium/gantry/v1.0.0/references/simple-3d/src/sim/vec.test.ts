import { describe, expect, it } from "vitest";
import {
  add,
  crossUp,
  DEG,
  distance,
  dot,
  length,
  nodeKey,
  parseNodeKey,
  radial,
  radius,
  rotateAboutY,
  scale,
  sub,
  vec3,
} from "./vec";

describe("vectors", () => {
  it("adds, subtracts, scales, and measures", () => {
    expect(add([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9]);
    expect(sub([1, 2, 3], [4, 5, 6])).toEqual([-3, -3, -3]);
    expect(scale([1, 2, 3], 2)).toEqual([2, 4, 6]);
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
    expect(length([3, 4, 0])).toBe(5);
    expect(distance([1, 0, 0], [4, 4, 0])).toBe(5);
  });

  it("takes the horizontal radius and radial vector about a vertical axis", () => {
    expect(radius([4, 9, 3], [1, -1])).toBeCloseTo(5, 12);
    expect(radial([4, 9, 3], [1, -1])).toEqual([3, 0, 4]);
  });

  it("writes k x r as (r.z, 0, -r.x)", () => {
    expect(crossUp([2, 7, 3])).toEqual([3, 0, -2]);
  });
});

describe("rotateAboutY", () => {
  it("turns +x toward +z for a positive angle, as yaw does", () => {
    const p = rotateAboutY(
      vec3(4, 5, 0),
      [0, 0],
      Math.cos(90 * DEG),
      Math.sin(90 * DEG),
    );
    expect(p[0]).toBeCloseTo(0, 12);
    expect(p[1]).toBe(5);
    expect(p[2]).toBeCloseTo(4, 12);
  });

  it("leaves the axis itself and the height alone", () => {
    const p = rotateAboutY(vec3(1, 7, 1), [1, 1], Math.cos(1), Math.sin(1));
    expect(p).toEqual([1, 7, 1]);
  });
});

describe("node keys", () => {
  it("round-trips a lattice node", () => {
    expect(parseNodeKey(nodeKey([-4, 0, 12]))).toEqual([-4, 0, 12]);
    expect(nodeKey([0, 2, 0])).toBe("0,2,0");
  });
});
