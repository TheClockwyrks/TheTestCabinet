// Wireworm — the diagnostics overlay (specs/instrumentation.md).
//
// It is read-only, off when the game starts, and every source is called fresh on
// every draw, so the panel reports the live game rather than the game it was
// registered over.

import { describe, expect, test } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { Diagnostics, OVERLAY_KEY } from "./overlay";

describe("the overlay", () => {
  test("it is off until it is toggled", () => {
    const panel = new Diagnostics();
    expect(panel.visible()).toBe(false);
    panel.toggle();
    expect(panel.visible()).toBe(true);
    panel.toggle();
    expect(panel.visible()).toBe(false);
  });

  test("the backtick key is the one that toggles it", () => {
    expect(OVERLAY_KEY).toBe("Backquote");
  });

  test("every source is read fresh on every read", () => {
    const panel = new Diagnostics();
    let reads = 0;
    panel.register("count", () => {
      reads += 1;
      return reads;
    });
    expect(panel.lines({ count: 1, dt: 0 })[1]).toBe("count 1");
    expect(panel.lines({ count: 1, dt: 0 })[1]).toBe("count 2");
  });

  test("the lines keep the order they were named in", () => {
    const panel = new Diagnostics();
    panel.register("a", () => 1);
    panel.register("b", () => 2);
    panel.register("c", () => 3);
    const lines = panel.lines({ count: 4, dt: 0.016 });
    expect(lines[0]).toContain("frame 4");
    expect(lines.slice(1)).toEqual(["a 1", "b 2", "c 3"]);
  });

  test("values are formatted short enough to read on a line", () => {
    const panel = new Diagnostics();
    panel.register("whole", () => 12);
    panel.register("fraction", () => 1.23456);
    panel.register("word", () => "playing");
    panel.register("thing", () => ({ a: 1 }));
    expect(panel.lines({ count: 0, dt: 0 }).slice(1)).toEqual([
      "whole 12",
      "fraction 1.23",
      "word playing",
      'thing {"a":1}',
    ]);
  });

  test("a source that throws is reported rather than raised", () => {
    const panel = new Diagnostics();
    panel.register("broken", () => {
      throw new Error("no");
    });
    panel.register("worse", () => {
      throw "no";
    });
    const lines = panel.lines({ count: 0, dt: 0 });
    expect(lines[1]).toBe("broken <no>");
    expect(lines[2]).toBe("worse <error>");
  });

  test("drawing hands the context back exactly as it was", () => {
    const panel = new Diagnostics();
    panel.register("screen", () => "title");
    const canvas = createCanvas(200, 100);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(2, 0, 0, 2, 10, 20);
    ctx.fillStyle = "#123456";

    // Hidden: it draws nothing.
    panel.draw(ctx as unknown as CanvasRenderingContext2D, {
      count: 1,
      dt: 0.016,
    });
    expect(ctx.getImageData(2, 2, 1, 1).data[3]).toBe(0);

    panel.toggle();
    panel.draw(ctx as unknown as CanvasRenderingContext2D, {
      count: 1,
      dt: 0.016,
    });
    expect(ctx.getImageData(2, 2, 1, 1).data[3]).toBeGreaterThan(0);
    // The transform the caller was carrying comes back untouched. (The style is
    // restored by the same `restore`, but the headless canvas this runs on does
    // not report a restored `fillStyle`, so only the transform is asserted.)
    const after = ctx.getTransform();
    expect([after.a, after.d, after.e, after.f]).toEqual([2, 2, 10, 20]);
  });
});
