// The debug overlay, and what Floe registers with it.
//
// Two things are checked separately because they fail separately: the panel
// (`src/overlay.ts`) — hidden to begin with, toggled, drawn over the finished
// picture and never taking the frame down with it — and the sources
// (`src/diagnostics.ts`), which must be pure reads of the live state and must
// name every fact the specification lists.

import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { Diagnostics, OVERLAY_KEY } from "./overlay";
import { registerDiagnostics } from "./diagnostics";
import { ROW_MEDIAN, WATER_TOP, tileLeft } from "./constants";
import { harness, lastId, startCrossing } from "./harness.test-support";
import type { InitApi } from "./runtime";

/** A diagnostics panel over an `InitApi` that registers straight into it. */
function panel(): { diagnostics: Diagnostics; api: InitApi } {
  const diagnostics = new Diagnostics();
  const api = {
    input: { register: () => undefined },
    audio: { define: () => undefined },
    diagnostics: {
      register: (name: string, source: () => unknown) =>
        diagnostics.register(name, source),
    },
  } as unknown as InitApi;
  return { diagnostics, api };
}

describe("the panel", () => {
  it("is bound to the backtick key", () => {
    expect(OVERLAY_KEY).toBe("Backquote");
  });

  it("starts hidden and toggles both ways", () => {
    const diagnostics = new Diagnostics();
    expect(diagnostics.visible()).toBe(false);
    diagnostics.toggle();
    expect(diagnostics.visible()).toBe(true);
    diagnostics.toggle();
    expect(diagnostics.visible()).toBe(false);
  });

  it("calls every source afresh on every read", () => {
    const diagnostics = new Diagnostics();
    let reads = 0;
    diagnostics.register("reads", () => (reads += 1));
    expect(diagnostics.lines({ count: 0, time: 0 })).toContain("reads 1");
    expect(diagnostics.lines({ count: 0, time: 0 })).toContain("reads 2");
  });

  it("keeps the order the sources were named in, heading first", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("first", () => "a");
    diagnostics.register("second", () => "b");
    expect(diagnostics.lines({ count: 7, time: 0.5 })).toEqual([
      "tick 7  t 0.50s",
      "first a",
      "second b",
    ]);
  });

  it("reports a source that throws rather than raising it", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("bad", () => {
      throw new Error("no reading");
    });
    expect(diagnostics.lines({ count: 0, time: 0 })).toContain(
      "bad <no reading>",
    );
  });

  it("shortens a fractional number and passes a string through", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("whole", () => 12);
    diagnostics.register("part", () => 1 / 3);
    diagnostics.register("words", () => "as written");
    diagnostics.register("thing", () => ({ a: 1 }));
    const lines = diagnostics.lines({ count: 0, time: 0 });
    expect(lines).toContain("whole 12");
    expect(lines).toContain("part 0.33");
    expect(lines).toContain("words as written");
    expect(lines).toContain('thing {"a":1}');
  });

  it("draws nothing while hidden and paints while shown", () => {
    const canvas = createCanvas(200, 100);
    const ctx = canvas.getContext("2d");
    const diagnostics = new Diagnostics();
    diagnostics.register("screen", () => "playing");

    const bare = ctx.getImageData(0, 0, 1, 1).data[3];
    diagnostics.draw(ctx as unknown as CanvasRenderingContext2D, {
      count: 0,
      time: 0,
    });
    expect(ctx.getImageData(0, 0, 1, 1).data[3]).toBe(bare);

    diagnostics.toggle();
    diagnostics.draw(ctx as unknown as CanvasRenderingContext2D, {
      count: 0,
      time: 0,
    });
    expect(ctx.getImageData(2, 2, 1, 1).data[3]).toBeGreaterThan(0);
  });

  it("hands the context back with the transform it arrived with", () => {
    const canvas = createCanvas(200, 100);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(2, 0, 0, 2, 30, 40);
    const before = ctx.getTransform();
    const diagnostics = new Diagnostics();
    diagnostics.register("screen", () => "playing");
    diagnostics.toggle();
    diagnostics.draw(ctx as unknown as CanvasRenderingContext2D, {
      count: 0,
      time: 0,
    });
    const after = ctx.getTransform();
    expect([after.a, after.d, after.e, after.f]).toEqual([
      before.a,
      before.d,
      before.e,
      before.f,
    ]);
  });
});

describe("what Floe registers", () => {
  it("names the screen, the run, the critter, the bears, the traffic and the bays", () => {
    const h = harness();
    const { diagnostics, api } = panel();
    registerDiagnostics(api, h.state);
    startCrossing(h);
    h.api.setScore(120);
    h.api.setCritterTile(9, ROW_MEDIAN);
    h.api.setCritterFacing("left");
    h.api.addBear(4, ROW_MEDIAN);
    const id = lastId(h.api.snapshot().bears);
    h.api.setBearTarget(id, 9, ROW_MEDIAN);
    h.api.addVehicle(11, "car", 0);
    h.api.addFloe(WATER_TOP, "pan", 0);
    h.api.setBay(2, true);

    const lines = diagnostics.lines({ count: 1, time: 0.01 }).join("\n");
    expect(lines).toContain("screen playing/crossing");
    expect(lines).toContain("level 1/8 reached 1");
    expect(lines).toContain("lives 3");
    expect(lines).toContain("score 120");
    expect(lines).toContain("timer 30");
    expect(lines).toMatch(/critter tile 9,10 at .* facing left on solid/);
    expect(lines).toMatch(
      new RegExp(`bears #${id} tile 4,10 at .* facing up hunting 9,10`),
    );
    expect(lines).toContain("traffic 1 vehicles, 1 floes");
    expect(lines).toContain("bays ..#..");
  });

  it("reports a swimming bear as swimming", () => {
    const h = harness();
    const { diagnostics, api } = panel();
    registerDiagnostics(api, h.state);
    startCrossing(h);
    h.api.addBear(20, WATER_TOP + 1);
    expect(diagnostics.lines({ count: 0, time: 0 }).join("\n")).toContain(
      "swimming",
    );
  });

  it("says so plainly when the critter is out of play, and when nothing hunts", () => {
    const h = harness();
    const { diagnostics, api } = panel();
    registerDiagnostics(api, h.state);
    startCrossing(h);
    h.api.removeCritter();
    const lines = diagnostics.lines({ count: 0, time: 0 }).join("\n");
    expect(lines).toContain("critter off the strait");
    expect(lines).toContain("bears none");
  });

  it("leaves the game exactly as it was", () => {
    const h = harness();
    const { diagnostics, api } = panel();
    registerDiagnostics(api, h.state);
    startCrossing(h);
    h.api.addBear(4, ROW_MEDIAN);
    h.api.addVehicle(11, "car", tileLeft(3));
    const before = h.api.snapshot();
    diagnostics.lines({ count: 0, time: 0 });
    diagnostics.lines({ count: 1, time: 1 });
    expect(h.api.snapshot()).toEqual(before);
  });
});
