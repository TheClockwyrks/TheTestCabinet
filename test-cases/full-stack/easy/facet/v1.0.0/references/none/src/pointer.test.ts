import { describe, expect, it } from "vitest";
import { Pointer, asPointerEvent } from "./pointer";

/** A pointer event carrying only what the pointer reads off one. */
function at(
  type: string,
  clientX: number,
  clientY: number,
  extra: Record<string, unknown> = {},
): Event {
  return Object.assign(new Event(type), { clientX, clientY, ...extra });
}

/** A map that halves client coordinates, so the mapping is visible in a value. */
const half = (x: number, y: number): { x: number; y: number } => ({
  x: x / 2,
  y: y / 2,
});

describe("asPointerEvent", () => {
  it("narrows anything carrying client coordinates", () => {
    expect(asPointerEvent(at("pointerdown", 4, 6))).toEqual({
      clientX: 4,
      clientY: 6,
    });
  });

  it("rejects a secondary pointer", () => {
    expect(asPointerEvent(at("pointerdown", 4, 6, { isPrimary: false }))).toBe(
      null,
    );
  });

  it("rejects an event with no coordinates", () => {
    expect(asPointerEvent(new Event("pointerdown"))).toBeNull();
  });
});

describe("Pointer", () => {
  it("reports the position in stage units, through the map", () => {
    const target = new EventTarget();
    const pointer = new Pointer(target, half);
    target.dispatchEvent(at("pointermove", 800, 400));
    expect(pointer.current()).toEqual({ x: 400, y: 200, down: false });
  });

  it("buffers every sample in arrival order", () => {
    const target = new EventTarget();
    const pointer = new Pointer(target, half);
    target.dispatchEvent(at("pointerdown", 100, 100));
    target.dispatchEvent(at("pointermove", 200, 100));
    target.dispatchEvent(at("pointermove", 300, 100));
    target.dispatchEvent(at("pointerup", 300, 100));
    expect(pointer.samples().map((sample) => [sample.type, sample.x])).toEqual([
      ["down", 50],
      ["move", 100],
      ["move", 150],
      ["up", 150],
    ]);
  });

  it("consumes the samples on read", () => {
    const target = new EventTarget();
    const pointer = new Pointer(target, half);
    target.dispatchEvent(at("pointerdown", 10, 10));
    expect(pointer.samples()).toHaveLength(1);
    expect(pointer.samples()).toHaveLength(0);
  });

  it("tracks the press state across a press and a release", () => {
    const target = new EventTarget();
    const pointer = new Pointer(target, half);
    target.dispatchEvent(at("pointerdown", 10, 10));
    expect(pointer.current().down).toBe(true);
    target.dispatchEvent(at("pointerup", 10, 10));
    expect(pointer.current().down).toBe(false);
  });

  it("does not repeat a press edge for a second button", () => {
    const target = new EventTarget();
    const pointer = new Pointer(target, half);
    target.dispatchEvent(at("pointerdown", 10, 10));
    target.dispatchEvent(at("pointerdown", 20, 10));
    const samples = pointer.samples();
    expect(samples.filter((sample) => sample.type === "down")).toHaveLength(1);
    // The position still moves with the ignored press.
    expect(pointer.current().x).toBe(10);
  });

  it("treats a cancel as a release", () => {
    const target = new EventTarget();
    const pointer = new Pointer(target, half);
    target.dispatchEvent(at("pointerdown", 10, 10));
    pointer.samples();
    target.dispatchEvent(at("pointercancel", 10, 10));
    expect(pointer.samples()[0]?.type).toBe("up");
    expect(pointer.current().down).toBe(false);
  });

  it("still records an edge while the fit is degenerate", () => {
    const target = new EventTarget();
    const pointer = new Pointer(target, () => null);
    target.dispatchEvent(at("pointerdown", 10, 10));
    expect(pointer.current()).toEqual({ x: 0, y: 0, down: true });
    expect(pointer.samples()).toHaveLength(1);
  });

  it("discards samples nothing consumed at the end of the frame", () => {
    const target = new EventTarget();
    const pointer = new Pointer(target, half);
    target.dispatchEvent(at("pointermove", 10, 10));
    pointer.endFrame();
    expect(pointer.samples()).toHaveLength(0);
  });

  it("stops listening once detached, and detaching twice is harmless", () => {
    const target = new EventTarget();
    const pointer = new Pointer(target, half);
    pointer.detach();
    pointer.detach();
    target.dispatchEvent(at("pointerdown", 10, 10));
    expect(pointer.samples()).toHaveLength(0);
  });
});
