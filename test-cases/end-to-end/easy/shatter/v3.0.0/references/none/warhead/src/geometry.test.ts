import { describe, expect, it } from "vitest";

import {
  CORE_R,
  FIELD_H,
  FIELD_W,
  MU,
  SOFTEN,
  STAR_X,
  STAR_Y,
  TICK_DT,
} from "./constants";
import {
  angleDelta,
  gravity,
  shortestDelta,
  sweptOverlap,
  turnToward,
  wrap,
  wrapOffsets,
  wrappedDistance,
} from "./geometry";

describe("the wrap", () => {
  it("brings a coordinate back into the field from either side", () => {
    expect(wrap(FIELD_W + 5, FIELD_W)).toBeCloseTo(5, 10);
    expect(wrap(-5, FIELD_W)).toBeCloseTo(FIELD_W - 5, 10);
    expect(wrap(0, FIELD_W)).toBe(0);
  });

  it("leaves a coordinate already inside alone", () => {
    expect(wrap(640, FIELD_W)).toBe(640);
  });
});

describe("the shortest wrapped separation", () => {
  it("crosses the seam rather than the field", () => {
    const delta = shortestDelta(10, 360, FIELD_W - 10, 360);
    expect(delta.x).toBeCloseTo(-20, 10);
    expect(delta.y).toBeCloseTo(0, 10);
  });

  it("measures a diagonal across both seams at once", () => {
    expect(wrappedDistance(5, 5, FIELD_W - 5, FIELD_H - 5)).toBeCloseTo(
      Math.hypot(10, 10),
      10,
    );
  });

  it("never reports more than half the field on an axis", () => {
    for (let x = 0; x < FIELD_W; x += 37) {
      const delta = shortestDelta(0, 0, x, 0);
      expect(Math.abs(delta.x)).toBeLessThanOrEqual(FIELD_W / 2);
    }
  });
});

describe("the well", () => {
  it("follows the inverse-square law outside the softening radius", () => {
    for (const d of [200, 150, 120]) {
      const a = gravity(STAR_X - d, STAR_Y);
      expect(Math.hypot(a.x, a.y)).toBeCloseTo(MU / (d * d), 6);
    }
  });

  it("is capped inside the softening radius", () => {
    const a = gravity(STAR_X - 60, STAR_Y);
    expect(Math.hypot(a.x, a.y)).toBeCloseTo(MU / (SOFTEN * SOFTEN), 6);
  });

  it("points at the star's centre from every bearing", () => {
    for (const bearing of [0, 1, 2.5, 4, 5.9]) {
      const x = STAR_X + Math.cos(bearing) * 240;
      const y = STAR_Y + Math.sin(bearing) * 240;
      const a = gravity(x, y);
      const toStar = Math.atan2(STAR_Y - y, STAR_X - x);
      expect(Math.abs(angleDelta(Math.atan2(a.y, a.x), toStar))).toBeLessThan(
        1e-9,
      );
    }
  });

  it("uses the direct vector, not a wrapped image of the star", () => {
    // Forty units inside the top-left corner: the direct distance is most of the
    // field, while the nearest wrapped image of the star would be far closer.
    const a = gravity(40, 40);
    const direct = Math.hypot(STAR_X - 40, STAR_Y - 40);
    expect(Math.hypot(a.x, a.y)).toBeCloseTo(MU / (direct * direct), 6);
    expect(a.x).toBeGreaterThan(0);
    expect(a.y).toBeGreaterThan(0);
  });

  it("is finite at the star's own centre", () => {
    const a = gravity(STAR_X, STAR_Y);
    expect(a.x).toBe(0);
    expect(a.y).toBe(0);
  });
});

describe("the swept overlap", () => {
  it("catches a pass that no sample at either end of the tick would", () => {
    // A bullet crossing a Small's centre at 1200 units a second: ten units of
    // travel in a tick against a combined radius of seventeen.
    const closing = 1200;
    expect(sweptOverlap(17 + 10, 0, -closing, 0, 17, TICK_DT)).toBe(true);
  });

  it("misses when the pass is wider than the combined radius", () => {
    expect(sweptOverlap(27, 20, -1200, 0, 17, TICK_DT)).toBe(false);
  });

  it("reports an overlap that was already there", () => {
    expect(sweptOverlap(3, 0, 0, 0, 17, TICK_DT)).toBe(true);
  });

  it("reports nothing for two bodies moving apart", () => {
    expect(sweptOverlap(20, 0, 400, 0, 17, TICK_DT)).toBe(false);
  });

  it("reports nothing for two still bodies clear of one another", () => {
    expect(sweptOverlap(20, 0, 0, 0, 17, TICK_DT)).toBe(false);
  });
});

describe("angles", () => {
  it("takes the shorter way round", () => {
    expect(angleDelta(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(0.2, 10);
  });

  it("turns no further than the step allows", () => {
    expect(turnToward(0, 1, 0.25)).toBeCloseTo(0.25, 10);
    expect(turnToward(0, -1, 0.25)).toBeCloseTo(-0.25, 10);
  });

  it("lands exactly on the target once it is within reach", () => {
    expect(turnToward(0, 0.1, 0.25)).toBeCloseTo(0.1, 10);
  });
});

describe("the wrapped copies a body is drawn as", () => {
  it("is one copy for a body clear of every seam", () => {
    expect(wrapOffsets(640, 360, 46)).toHaveLength(1);
  });

  it("is two for a body on one seam", () => {
    const offsets = wrapOffsets(4, 360, 46);
    expect(offsets).toHaveLength(2);
    expect(offsets[1]).toEqual({ x: FIELD_W, y: 0 });
  });

  it("is four for a body in a corner", () => {
    expect(wrapOffsets(4, 4, 46)).toHaveLength(4);
  });

  it("keeps the body's own copy first", () => {
    expect(wrapOffsets(FIELD_W - 2, FIELD_H - 2, CORE_R)[0]).toEqual({
      x: 0,
      y: 0,
    });
  });
});
