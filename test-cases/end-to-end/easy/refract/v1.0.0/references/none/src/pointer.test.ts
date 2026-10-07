// The pointer: client-space events mapped into stage units, buffered as
// press/move/release samples in arrival order, with the current position and
// pressed bit the game mirrors into its state every frame.

import { describe, expect, it } from "vitest";
import { Pointer, asPointerEvent, type StageMap } from "./pointer";

class PointerEvt extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary: boolean;

  constructor(type: string, x: number, y: number, isPrimary = true) {
    super(type);
    this.clientX = x;
    this.clientY = y;
    this.isPrimary = isPrimary;
  }
}

/** A pointer over an identity map, or over a map of the test's choosing. */
function pointer(map: StageMap = (x, y) => ({ x, y })): {
  target: EventTarget;
  input: Pointer;
} {
  const target = new EventTarget();
  return { target, input: new Pointer(target, map) };
}

describe("samples", () => {
  it("buffers press, move, and release in arrival order", () => {
    const { target, input } = pointer();
    target.dispatchEvent(new PointerEvt("pointerdown", 10, 20));
    target.dispatchEvent(new PointerEvt("pointermove", 30, 40));
    target.dispatchEvent(new PointerEvt("pointerup", 30, 40));
    expect(input.samples()).toEqual([
      { type: "down", x: 10, y: 20, device: "mouse", primary: true },
      { type: "move", x: 30, y: 40, device: "mouse", primary: true },
      { type: "up", x: 30, y: 40, device: "mouse", primary: true },
    ]);
  });

  it("consumes on read and discards leftovers at frame end", () => {
    const { target, input } = pointer();
    target.dispatchEvent(new PointerEvt("pointermove", 1, 2));
    expect(input.samples()).toHaveLength(1);
    expect(input.samples()).toEqual([]);

    target.dispatchEvent(new PointerEvt("pointermove", 3, 4));
    input.endFrame();
    expect(input.samples()).toEqual([]);
  });

  it("maps every sample through the stage map it was given", () => {
    const { target, input } = pointer((x, y) => ({ x: x / 2, y: y / 2 }));
    target.dispatchEvent(new PointerEvt("pointerdown", 100, 200));
    expect(input.samples()).toEqual([
      { type: "down", x: 50, y: 100, device: "mouse", primary: true },
    ]);
  });

  it("treats pointercancel as the release it is", () => {
    const { target, input } = pointer();
    target.dispatchEvent(new PointerEvt("pointerdown", 5, 5));
    target.dispatchEvent(new PointerEvt("pointercancel", 5, 5));
    expect(input.samples().map((sample) => sample.type)).toEqual([
      "down",
      "up",
    ]);
    expect(input.current().down).toBe(false);
  });

  it("does not repeat an edge for a secondary button or duplicate event", () => {
    const { target, input } = pointer();
    target.dispatchEvent(new PointerEvt("pointerdown", 1, 1));
    target.dispatchEvent(new PointerEvt("pointerdown", 2, 2));
    target.dispatchEvent(new PointerEvt("pointerup", 3, 3));
    target.dispatchEvent(new PointerEvt("pointerup", 4, 4));
    expect(input.samples().map((sample) => sample.type)).toEqual([
      "down",
      "up",
    ]);
  });

  it("lists a non-primary pointer but leaves the position and the hold alone", () => {
    const { target, input } = pointer();
    target.dispatchEvent(new PointerEvt("pointerdown", 9, 9, false));
    // The game acts on the primary pointer alone, so the sample is listed and
    // the snapshot the game mirrors does not move (specs/controls.md).
    expect(input.samples().map((sample) => sample.primary)).toEqual([false]);
    expect(input.current()).toEqual({
      x: 0,
      y: 0,
      down: false,
      device: "mouse",
    });
  });

  it("ignores an event carrying no client coordinates", () => {
    const { target, input } = pointer();
    target.dispatchEvent(new Event("pointermove"));
    expect(input.samples()).toEqual([]);
  });
});

describe("current", () => {
  it("tracks the mapped position and the pressed bit", () => {
    const { target, input } = pointer();
    expect(input.current()).toEqual({
      x: 0,
      y: 0,
      down: false,
      device: "mouse",
    });
    target.dispatchEvent(new PointerEvt("pointerdown", 10, 20));
    expect(input.current()).toEqual({
      x: 10,
      y: 20,
      down: true,
      device: "mouse",
    });
    target.dispatchEvent(new PointerEvt("pointermove", 30, 40));
    target.dispatchEvent(new PointerEvt("pointerup", 30, 40));
    expect(input.current()).toEqual({
      x: 30,
      y: 40,
      down: false,
      device: "mouse",
    });
  });

  it("holds its position while the map is degenerate, keeping the edges", () => {
    let broken = false;
    const { target, input } = pointer((x, y) => (broken ? null : { x, y }));
    target.dispatchEvent(new PointerEvt("pointermove", 50, 60));
    input.endFrame();
    broken = true;
    target.dispatchEvent(new PointerEvt("pointerdown", 999, 999));
    expect(input.samples()).toEqual([
      { type: "down", x: 50, y: 60, device: "mouse", primary: true },
    ]);
    expect(input.current()).toEqual({
      x: 50,
      y: 60,
      down: true,
      device: "mouse",
    });
  });
});

describe("detach", () => {
  it("stops listening, idempotently", () => {
    const { target, input } = pointer();
    input.detach();
    input.detach();
    target.dispatchEvent(new PointerEvt("pointerdown", 1, 1));
    expect(input.samples()).toEqual([]);
  });
});

describe("asPointerEvent", () => {
  it("narrows structurally on client coordinates, and reports the device", () => {
    expect(asPointerEvent(new PointerEvt("pointerdown", 1, 2))).toEqual({
      clientX: 1,
      clientY: 2,
      pointerId: 0,
      device: "mouse",
      primary: true,
    });
    expect(
      asPointerEvent(new PointerEvt("pointerdown", 1, 2, false))?.primary,
    ).toBe(false);
    expect(asPointerEvent(new Event("pointerdown"))).toBeNull();
  });
});
