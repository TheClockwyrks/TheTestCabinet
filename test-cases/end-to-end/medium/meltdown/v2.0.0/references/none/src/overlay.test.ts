// The debug overlay.
//
// Read-only is the whole point (specs/instrumentation.md): it draws the values
// the game named, it is toggled by the backtick key, it starts hidden, and a
// source that throws is reported rather than raised.

import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { Diagnostics, OVERLAY_KEY } from "./overlay";

const FRAME = { count: 7, dt: 1 / 60 };

function context(): CanvasRenderingContext2D {
  const canvas = createCanvas(320, 240);
  return canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
}

describe("the toggle", () => {
  it("is the backtick key, and the panel starts hidden", () => {
    expect(OVERLAY_KEY).toBe("Backquote");
    const panel = new Diagnostics<number>();
    expect(panel.visible()).toBe(false);
    panel.toggle();
    expect(panel.visible()).toBe(true);
    panel.toggle();
    expect(panel.visible()).toBe(false);
  });
});

describe("the lines", () => {
  it("opens with the frame position and then every source, in order", () => {
    const panel = new Diagnostics<{ money: number }>();
    panel.register("money", (state) => state.money);
    panel.register("wave", () => "3/20");
    expect(panel.lines(FRAME, { money: 250 })).toEqual([
      "frame 7  dt 16.67ms",
      "money 250",
      "wave 3/20",
    ]);
  });

  it("spreads an array source over one line each", () => {
    const panel = new Diagnostics<null>();
    panel.register("towers", () => ["#1 arc", "#2 rime"]);
    expect(panel.lines(FRAME, null)).toEqual([
      "frame 7  dt 16.67ms",
      "towers #1 arc",
      "towers #2 rime",
    ]);
  });

  it("shortens a fractional number and leaves a whole one alone", () => {
    const panel = new Diagnostics<null>();
    panel.register("heat", () => 61.23456);
    panel.register("kills", () => 4);
    expect(panel.lines(FRAME, null)).toContain("heat 61.23");
    expect(panel.lines(FRAME, null)).toContain("kills 4");
  });

  it("reports a throwing source in its own line rather than raising it", () => {
    const panel = new Diagnostics<null>();
    panel.register("broken", () => {
      throw new Error("no read");
    });
    panel.register("after", () => "still here");
    expect(panel.lines(FRAME, null)).toEqual([
      "frame 7  dt 16.67ms",
      "broken <no read>",
      "after still here",
    ]);
  });

  it("calls every source fresh on each read, so the panel is never stale", () => {
    const panel = new Diagnostics<{ money: number }>();
    panel.register("money", (state) => state.money);
    const state = { money: 1 };
    expect(panel.lines(FRAME, state)).toContain("money 1");
    state.money = 2;
    expect(panel.lines(FRAME, state)).toContain("money 2");
  });

  it("stops at its own ceiling, so a long roster cannot fill the screen", () => {
    const panel = new Diagnostics<null>();
    panel.register("many", () =>
      Array.from({ length: 200 }, (_v, i) => `row ${i}`),
    );
    expect(panel.lines(FRAME, null).length).toBeLessThanOrEqual(44);
  });
});

describe("drawing", () => {
  it("draws nothing at all while it is hidden", () => {
    const panel = new Diagnostics<null>();
    panel.register("x", () => 1);
    const ctx = context();
    panel.draw(ctx, FRAME, null);
    const { data } = ctx.getImageData(2, 2, 1, 1);
    expect(data[3]).toBe(0);
  });

  it("paints its own ground once shown", () => {
    const panel = new Diagnostics<null>();
    panel.register("x", () => 1);
    const ctx = context();
    panel.toggle();
    panel.draw(ctx, FRAME, null);
    const { data } = ctx.getImageData(2, 2, 1, 1);
    expect(data[3]).toBeGreaterThan(0);
  });

  it("hands the transform back exactly as it was given", () => {
    const panel = new Diagnostics<null>();
    panel.register("x", () => 1);
    const ctx = context();
    ctx.setTransform(2, 0, 0, 2, 30, 40);
    panel.toggle();
    panel.draw(ctx, FRAME, null);
    const after = (
      ctx as unknown as { getTransform(): DOMMatrix }
    ).getTransform();
    expect([after.a, after.d, after.e, after.f]).toEqual([2, 2, 30, 40]);
  });
});
