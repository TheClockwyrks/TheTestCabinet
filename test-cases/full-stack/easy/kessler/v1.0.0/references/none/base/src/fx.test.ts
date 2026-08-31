// The particle layer: the player is handed the field's own context, effects
// advance on the game clock passed in, and a spent effect retires.

import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { STAGE_SIZE } from "./constants";
import { Fx } from "./fx";
import { bareAssets, committedSystems } from "./render.test";

function fieldContext(): CanvasRenderingContext2D {
  return createCanvas(STAGE_SIZE, STAGE_SIZE).getContext(
    "2d",
  ) as unknown as CanvasRenderingContext2D;
}

describe("Fx", () => {
  it("plays a committed system over the field context and retires it", () => {
    const assets = bareAssets();
    assets.systems = committedSystems();
    const fx = new Fx(assets);
    const ctx = fieldContext();
    fx.spawn("burst", 500, 200);
    expect(fx.count).toBe(1);
    fx.draw(ctx, 0); // builds the player, composites the opening state
    for (let i = 0; i < 300 && fx.count > 0; i += 1) {
      fx.draw(ctx, 1 / 60);
    }
    expect(fx.count).toBe(0);
  });

  it("skips a system whose file is not loaded", () => {
    const fx = new Fx(bareAssets());
    fx.spawn("spark", 100, 100);
    expect(fx.count).toBe(0);
  });

  it("clears every live effect on demand", () => {
    const assets = bareAssets();
    assets.systems = committedSystems();
    const fx = new Fx(assets);
    fx.spawn("burnup", 500, 420);
    fx.clear();
    expect(fx.count).toBe(0);
  });
});
