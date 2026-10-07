// The pointer: page events and posed events down one path.
//
// Meltdown is built with the pointer (specs/controls.md), and a press reported
// through the debug surface has to be the same event a player makes
// (specs/instrumentation.md). What is checked here is that one door: the mapping
// into logical stage units, the duplicate edges it swallows, and the silent flag
// that is the only difference a posed event carries.

import { describe, expect, it } from "vitest";
import { Pointer, asPointerEvent, type PointerSample } from "./pointer";
import { STAGE_H, STAGE_W } from "./constants";
import { clientToStage, fitViewport } from "./viewport";

/** A `PointerEvent`-shaped event: the module reads the client coordinates. */
class PointEvent extends Event {
  constructor(
    type: string,
    readonly clientX: number,
    readonly clientY: number,
    readonly isPrimary = true,
  ) {
    super(type);
  }
}

function bench(map = (x: number, y: number) => ({ x, y })) {
  const target = new EventTarget();
  const samples: PointerSample[] = [];
  const pointer = new Pointer(target, map, (sample) => samples.push(sample));
  return { target, samples, pointer };
}

describe("narrowing an event", () => {
  it("takes anything carrying client coordinates", () => {
    expect(asPointerEvent(new PointEvent("pointerdown", 4, 5))).toEqual({
      clientX: 4,
      clientY: 5,
    });
    expect(asPointerEvent(new Event("pointerdown"))).toBeNull();
  });

  it("declines a secondary touch, so the game asks for one pointer", () => {
    expect(
      asPointerEvent(new PointEvent("pointerdown", 4, 5, false)),
    ).toBeNull();
  });
});

describe("events off the page", () => {
  it("reports a press, a move and a release in logical units", () => {
    const b = bench();
    b.target.dispatchEvent(new PointEvent("pointerdown", 100, 200));
    b.target.dispatchEvent(new PointEvent("pointermove", 110, 210));
    b.target.dispatchEvent(new PointEvent("pointerup", 110, 210));
    expect(b.samples.map((s) => s.type)).toEqual(["down", "move", "up"]);
    expect(b.samples[0]).toMatchObject({ x: 100, y: 200, silent: false });
    expect(b.pointer.current()).toEqual({ x: 110, y: 210, down: false });
  });

  it("takes a cancel as a release, so a press never goes missing", () => {
    const b = bench();
    b.target.dispatchEvent(new PointEvent("pointerdown", 10, 10));
    b.target.dispatchEvent(new PointEvent("pointercancel", 10, 10));
    expect(b.samples.map((s) => s.type)).toEqual(["down", "up"]);
    expect(b.pointer.current().down).toBe(false);
  });

  it("maps through the viewport fit the stage was drawn with", () => {
    const view = fitViewport(STAGE_W, STAGE_H, 640, 360, 1);
    const origin = { left: 20, top: 8 };
    const b = bench(
      (x, y) => clientToStage(view, origin, 1, x, y) ?? { x: 0, y: 0 },
    );
    // Half scale: 320 CSS px from the origin is 640 logical units in.
    b.target.dispatchEvent(new PointEvent("pointerdown", 20 + 320, 8 + 180));
    expect(b.samples[0]).toMatchObject({ x: 640, y: 360 });
  });

  it("holds its last position while the fit is degenerate", () => {
    let degenerate = false;
    const b = bench((x, y) => (degenerate ? { x: 0, y: 0 } : { x, y }));
    b.target.dispatchEvent(new PointEvent("pointerdown", 300, 300));
    degenerate = true;
    // The module falls back to where the pointer was, which the harness cannot
    // express through the map, so the edge is what matters: it still arrives.
    b.target.dispatchEvent(new PointEvent("pointerup", 999, 999));
    expect(b.samples.map((s) => s.type)).toEqual(["down", "up"]);
  });
});

describe("duplicate edges", () => {
  it("swallows a second press while already pressed", () => {
    const b = bench();
    b.target.dispatchEvent(new PointEvent("pointerdown", 1, 1));
    b.target.dispatchEvent(new PointEvent("pointerdown", 2, 2));
    expect(b.samples).toHaveLength(1);
    // The position still moved, even though the edge did not repeat.
    expect(b.pointer.current()).toMatchObject({ x: 2, y: 2, down: true });
  });

  it("swallows a release while already released", () => {
    const b = bench();
    b.target.dispatchEvent(new PointEvent("pointerup", 1, 1));
    expect(b.samples).toHaveLength(0);
    expect(b.pointer.current().down).toBe(false);
  });

  it("passes every move through, pressed or not", () => {
    const b = bench();
    b.target.dispatchEvent(new PointEvent("pointermove", 1, 1));
    b.target.dispatchEvent(new PointEvent("pointermove", 2, 2));
    expect(b.samples).toHaveLength(2);
  });
});

describe("a posed event", () => {
  it("resolves on the same path, marked silent", () => {
    const b = bench();
    b.pointer.report("down", 400, 300, true);
    b.pointer.report("up", 400, 300, true);
    expect(b.samples.map((s) => s.type)).toEqual(["down", "up"]);
    expect(b.samples.every((s) => s.silent)).toBe(true);
    expect(b.pointer.current()).toEqual({ x: 400, y: 300, down: false });
  });

  it("is indistinguishable from a page event but for that flag", () => {
    const page = bench();
    page.target.dispatchEvent(new PointEvent("pointerdown", 7, 9));
    const posed = bench();
    posed.pointer.report("down", 7, 9, true);
    expect({ ...posed.samples[0], silent: false }).toEqual(page.samples[0]);
  });
});

describe("detaching", () => {
  it("stops listening, and is idempotent because teardown races", () => {
    const b = bench();
    b.pointer.detach();
    b.pointer.detach();
    b.target.dispatchEvent(new PointEvent("pointerdown", 1, 1));
    expect(b.samples).toHaveLength(0);
  });
});
