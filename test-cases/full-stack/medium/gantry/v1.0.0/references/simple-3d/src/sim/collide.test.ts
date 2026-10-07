import { describe, expect, it } from "vitest";
import {
  loadBelowGround,
  loadStrikesAny,
  segmentInsideBox,
  segmentStrikesAny,
  yawedBoxInsideBox,
} from "./collide";
import { classHalfExtents } from "./site";
import type { Box } from "./types";

const box: Box = { min: [0, 0, 0], max: [2, 4, 2] };

describe("a segment against an obstacle", () => {
  it("meets it only where it reaches strictly inside", () => {
    expect(segmentInsideBox([1, 2, 1], [5, 2, 1], box)).toBe(true);
    expect(segmentInsideBox([3, 2, 1], [5, 2, 1], box)).toBe(false);
  });

  it("is clear of a face it lies flush along", () => {
    expect(segmentInsideBox([-1, 4, 1], [3, 4, 1], box)).toBe(false);
    expect(segmentInsideBox([0, -1, 0], [0, 5, 0], box)).toBe(false);
  });

  it("is clear of a face it merely grazes", () => {
    expect(segmentInsideBox([-1, 2, 1], [0, 2, 1], box)).toBe(false);
    expect(segmentInsideBox([-2, 6, -2], [2, 4, 2], box)).toBe(false);
  });

  it("catches a segment that crosses the box corner to corner", () => {
    expect(segmentInsideBox([-1, -1, -1], [3, 5, 3], box)).toBe(true);
  });

  it("tests every obstacle a site carries", () => {
    expect(segmentStrikesAny([1, 2, 1], [1, 2, 5], [])).toBe(false);
    expect(segmentStrikesAny([1, 2, 1], [1, 2, 5], [box])).toBe(true);
  });
});

describe("a yawed load box against an obstacle", () => {
  const half = classHalfExtents("crate");

  it("is clear resting flush on the obstacle's top face", () => {
    // A crate is two units tall, so a lift point at y = 6 puts its bottom face
    // exactly on a top face at y = 4.
    expect(loadStrikesAny([1, 6, 1], 0, half, [box])).toBe(false);
  });

  it("reaches inside when it dips below that face", () => {
    expect(loadStrikesAny([1, 5.9, 1], 0, half, [box])).toBe(true);
  });

  it("is clear standing exactly alongside, and caught when the yaw swings it in", () => {
    // Centered at x = 3.05 the square just clears x = 2 at yaw 0, and its corner
    // reaches x = 3.05 - sqrt(2) at yaw 45.
    expect(loadStrikesAny([3.05, 3, 1], 0, half, [box])).toBe(false);
    expect(loadStrikesAny([3.05, 3, 1], 45, half, [box])).toBe(true);
  });

  it("separates on the vertical on its own", () => {
    expect(yawedBoxInsideBox([1, 5, 1], 0, half, box)).toBe(false);
    expect(yawedBoxInsideBox([1, 3, 1], 0, half, box)).toBe(true);
  });
});

describe("the ground", () => {
  it("lets a load rest with its bottom face exactly on y = 0", () => {
    expect(loadBelowGround([0, 2, 0], 2)).toBe(false);
    expect(loadBelowGround([0, 1.9999, 0], 2)).toBe(true);
  });
});
