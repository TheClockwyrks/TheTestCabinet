// The diagnostics overlay. specs/instrumentation.md asks for a panel of named
// values that is toggled by the backtick key, drawn over the finished frame, and
// read-only — so what is checked here is the content of the lines, that reading
// them changes nothing, and that drawing the panel leaves the context exactly as
// it was handed over.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { beforeEach, describe, expect, it } from "vitest";
import { Diagnostics, OVERLAY_KEY } from "./overlay";

/** A real 2D context, as the runtime hands one over: the logical transform set. */
function context(scale = 2, offsetX = 40, offsetY = 10): SKRSContext2D {
  const ctx = createCanvas(400, 200).getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
  return ctx;
}

/** Every pixel the panel would cover, as one number: zero means nothing drawn. */
function inkAtOrigin(ctx: SKRSContext2D): number {
  const { data } = ctx.getImageData(0, 0, 60, 40);
  return data.reduce((total, channel) => total + channel, 0);
}

let panel: Diagnostics;

beforeEach(() => {
  panel = new Diagnostics();
});

describe("toggling", () => {
  it("starts hidden, so a player never meets it by accident", () => {
    expect(panel.visible()).toBe(false);
  });

  it("shows and hides", () => {
    panel.toggle();
    expect(panel.visible()).toBe(true);
    panel.toggle();
    expect(panel.visible()).toBe(false);
  });

  it("names the backtick key, which is the key specs/instrumentation.md fixes", () => {
    expect(OVERLAY_KEY).toBe("Backquote");
  });
});

describe("the lines", () => {
  it("is empty until a value is named, so the panel is only what the game asked for", () => {
    expect(panel.lines()).toEqual([]);
  });

  it("keeps the registered sources in the order they were named", () => {
    panel.register("screen", () => "playing");
    panel.register("score", () => "3 - 1");
    expect(panel.lines()).toEqual(["screen playing", "score 3 - 1"]);
  });

  it("calls each source afresh, so the panel reports the live game", () => {
    let score = 0;
    panel.register("score", () => score);
    expect(panel.lines()[0]).toBe("score 0");
    score = 4;
    expect(panel.lines()[0]).toBe("score 4");
  });

  it("keeps a number short: whole numbers plain, the rest to two places", () => {
    panel.register("whole", () => 12);
    panel.register("fraction", () => 12.3456);
    expect(panel.lines()).toEqual(["whole 12", "fraction 12.35"]);
  });

  it("reports a source that throws instead of taking the frame down", () => {
    panel.register("broken", () => {
      throw new Error("no such thing");
    });
    expect(panel.lines()[0]).toBe("broken <no such thing>");
  });

  it("replaces a source registered twice under one name", () => {
    panel.register("screen", () => "title");
    panel.register("screen", () => "playing");
    expect(panel.lines()).toHaveLength(1);
    expect(panel.lines()[0]).toBe("screen playing");
  });
});

describe("drawing", () => {
  it("draws nothing while it is hidden", () => {
    const ctx = context();
    panel.register("screen", () => "playing");
    panel.draw(ctx as unknown as CanvasRenderingContext2D);
    expect(inkAtOrigin(ctx)).toBe(0);
  });

  it("draws nothing when shown with no value named", () => {
    const ctx = context();
    panel.toggle();
    panel.draw(ctx as unknown as CanvasRenderingContext2D);
    expect(inkAtOrigin(ctx)).toBe(0);
  });

  it("draws over the top-left corner in device space once shown", () => {
    const ctx = context();
    panel.register("screen", () => "playing");
    panel.toggle();
    panel.draw(ctx as unknown as CanvasRenderingContext2D);
    // In device space: the panel starts at the canvas corner, not at the field's,
    // so the scale and letterbox offset of the frame do not move it.
    expect(inkAtOrigin(ctx)).toBeGreaterThan(0);
  });

  it("hands the context back exactly as it was given", () => {
    const ctx = context(3, 12, 7);
    panel.register("screen", () => "playing");
    panel.toggle();
    const before = ctx.getTransform();
    const font = ctx.font;

    panel.draw(ctx as unknown as CanvasRenderingContext2D);

    // The whole panel is bracketed by save/restore, so the frame's transform and
    // the drawing state it was carrying both survive it.
    const after = ctx.getTransform();
    expect([after.a, after.d, after.e, after.f]).toEqual([
      before.a,
      before.d,
      before.e,
      before.f,
    ]);
    expect(ctx.font).toBe(font);
  });
});
