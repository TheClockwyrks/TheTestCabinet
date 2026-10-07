// The sweep: touching over a whole tick, and penetrating over one.

import { describe, expect, it } from "vitest";
import { TICK_DT } from "./constants";
import { sweepInside, sweepTouch } from "./collision";

/** A body the sweep can read: where it ended, and how far it moved. */
function body(
  x: number,
  y: number,
  vx: number,
  vy: number,
  r: number,
): { x: number; y: number; dx: number; dy: number; r: number } {
  return { x, y, dx: vx * TICK_DT, dy: vy * TICK_DT, r };
}

describe("touching", () => {
  it("catches a body that crossed another entirely inside one tick", () => {
    // Ends 400 past a rock it started 100 short of: sampling the ends misses it.
    const fast = body(600, 100, 60_000, 0, 3);
    const rock = body(300, 100, 0, 0, 46);
    expect(sweepTouch(fast, rock)).not.toBeNull();
  });

  it("reports nothing for a body that never came within the radii", () => {
    const shot = body(600, 400, 60_000, 0, 3);
    const rock = body(300, 100, 0, 0, 46);
    expect(sweepTouch(shot, rock)).toBeNull();
  });

  it("counts an overlap that was already there at the start of the tick", () => {
    expect(sweepTouch(body(100, 100, 0, 0, 10), body(105, 100, 0, 0, 10))).toBe(
      0,
    );
  });

  it("catches two bodies touching across a seam", () => {
    expect(
      sweepTouch(body(4, 300, 0, 0, 3), body(1276, 300, 0, 0, 46)),
    ).not.toBeNull();
  });
});

describe("penetrating", () => {
  it("ignores a body resting exactly on the surface and leaving", () => {
    // It STARTED the tick exactly on the surface and moved outward: touching,
    // never penetrating, so the slide leaves it alone rather than pinning it.
    const resting = body(144 + 200 * TICK_DT, 360, 200, 0, 14);
    const core = body(100, 360, 0, 0, 30);
    expect(sweepInside(resting, core)).toBeNull();
  });

  it("catches a body pressed into the surface", () => {
    const pressing = body(144 - 200 * TICK_DT, 360, -200, 0, 14);
    const core = body(100, 360, 0, 0, 30);
    expect(sweepInside(pressing, core)).not.toBeNull();
  });

  it("reports nothing for a body that only grazed", () => {
    const grazing = body(400, 316, 30_000, 0, 14);
    const core = body(100, 360, 0, 0, 30);
    expect(sweepInside(grazing, core)).toBeNull();
  });
});
