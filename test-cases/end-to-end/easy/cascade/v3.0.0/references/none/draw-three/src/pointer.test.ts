// The pointer, normalized: a mouse and a touchscreen on the same footing.

import { describe, expect, it } from "vitest";
import { asPointerEvent, POINTER_EVENTS } from "./pointer";

class Point extends Event {
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

describe("asPointerEvent", () => {
  it("reads a primary pointer", () => {
    const pointer = asPointerEvent(new Point("pointerdown", 40, 90));
    expect(pointer?.clientX).toBe(40);
    expect(pointer?.clientY).toBe(90);
  });

  it("ignores a non-primary touch", () => {
    expect(asPointerEvent(new Point("pointerdown", 40, 90, false))).toBeNull();
  });

  it("ignores an event carrying no point", () => {
    expect(asPointerEvent(new Event("pointerdown"))).toBeNull();
  });
});

describe("POINTER_EVENTS", () => {
  it("covers the press, the travel, the release and the cancellation", () => {
    expect(POINTER_EVENTS.map(([type]) => type)).toEqual([
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
    ]);
    expect(POINTER_EVENTS.map(([, phase]) => phase)).toEqual([
      "down",
      "move",
      "up",
      "cancel",
    ]);
  });
});
