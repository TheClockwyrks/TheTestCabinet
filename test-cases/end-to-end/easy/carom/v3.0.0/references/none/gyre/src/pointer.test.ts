// The pointer layer: the mouse and the finger, mapped and buffered.
//
// What matters here is the SHAPE of what reaches the game — the device, the
// phase, and a position already in logical units — and that a sample is news for
// exactly one frame, as a key press is.

import { describe, expect, it } from "vitest";
import { PointerInput, asPointerEvent, type PointerSample } from "./pointer";

/** A pointer event as the browser raises one, reduced to what the build reads. */
class PointerEventStub extends Event {
  readonly pointerType: string;
  readonly clientX: number;
  readonly clientY: number;

  constructor(type: string, x: number, y: number, pointerType = "mouse") {
    super(type);
    this.pointerType = pointerType;
    this.clientX = x;
    this.clientY = y;
  }
}

/** A pointer over a surface offset by (100, 50) and scaled by two. */
function harness(): { target: EventTarget; input: PointerInput } {
  const target = new EventTarget();
  const input = new PointerInput(target, (clientX, clientY) => ({
    x: (clientX - 100) / 2,
    y: (clientY - 50) / 2,
  }));
  return { target, input };
}

/** The newest sample buffered, which is the one a gesture's last edge left. */
function lastOf(input: PointerInput): PointerSample | undefined {
  const samples = input.pending();
  return samples[samples.length - 1];
}

describe("asPointerEvent", () => {
  it("takes any event carrying a position", () => {
    expect(asPointerEvent(new PointerEventStub("pointermove", 1, 2))).not.toBe(
      null,
    );
  });

  it("refuses an event with no position on it", () => {
    expect(asPointerEvent(new Event("pointermove"))).toBeNull();
  });
});

describe("PointerInput", () => {
  it("maps a mouse move into logical units", () => {
    const { target, input } = harness();
    target.dispatchEvent(new PointerEventStub("pointermove", 300, 250));
    expect(input.pending()).toEqual([
      { kind: "mouse", phase: "move", x: 100, y: 100 },
    ]);
  });

  it("keeps the samples in the order they arrived", () => {
    const { target, input } = harness();
    target.dispatchEvent(new PointerEventStub("pointermove", 100, 50));
    target.dispatchEvent(new PointerEventStub("pointerdown", 100, 50));
    target.dispatchEvent(new PointerEventStub("pointerup", 100, 50));
    expect(input.pending().map((s) => s.phase)).toEqual(["move", "down", "up"]);
  });

  it("tells a finger from a mouse", () => {
    const { target, input } = harness();
    target.dispatchEvent(new PointerEventStub("pointerdown", 100, 50, "touch"));
    target.dispatchEvent(new PointerEventStub("pointerdown", 100, 50, "pen"));
    expect(input.pending().map((s) => s.kind)).toEqual(["touch", "mouse"]);
  });

  it("resolves a touch lift where the contact last was", () => {
    const { target, input } = harness();
    target.dispatchEvent(new PointerEventStub("pointerdown", 100, 50, "touch"));
    target.dispatchEvent(
      new PointerEventStub("pointermove", 300, 250, "touch"),
    );
    // A real touch end carries no position at all, so this hands over a nonsense
    // one and expects the last place the contact was seen instead.
    target.dispatchEvent(
      new PointerEventStub("pointerup", -999, -999, "touch"),
    );
    expect(lastOf(input)).toEqual({
      kind: "touch",
      phase: "up",
      x: 100,
      y: 100,
    });
  });

  it("raises no lift for a contact it never saw land", () => {
    const { target, input } = harness();
    target.dispatchEvent(new PointerEventStub("pointerup", 300, 250, "touch"));
    expect(input.pending()).toEqual([]);
  });

  it("forgets a contact the browser took over", () => {
    const { target, input } = harness();
    target.dispatchEvent(new PointerEventStub("pointerdown", 100, 50, "touch"));
    target.dispatchEvent(
      new PointerEventStub("pointercancel", 100, 50, "touch"),
    );
    input.endFrame();
    target.dispatchEvent(new PointerEventStub("pointerup", 100, 50, "touch"));
    expect(input.pending()).toEqual([]);
  });

  it("takes a mouse release at the position the event carries", () => {
    const { target, input } = harness();
    target.dispatchEvent(new PointerEventStub("pointerdown", 100, 50));
    target.dispatchEvent(new PointerEventStub("pointerup", 300, 250));
    expect(lastOf(input)).toMatchObject({ x: 100, y: 100 });
  });

  it("ignores an event with no position on it", () => {
    const { target, input } = harness();
    target.dispatchEvent(new Event("pointerdown"));
    expect(input.pending()).toEqual([]);
  });

  it("discards every sample at the end of a frame", () => {
    const { target, input } = harness();
    target.dispatchEvent(new PointerEventStub("pointermove", 100, 50));
    expect(input.pending()).toHaveLength(1);
    input.endFrame();
    expect(input.pending()).toEqual([]);
    input.endFrame(); // idempotent
    expect(input.pending()).toEqual([]);
  });

  it("stops listening once detached, and detaches only once", () => {
    const { target, input } = harness();
    input.detach();
    input.detach();
    target.dispatchEvent(new PointerEventStub("pointermove", 100, 50));
    expect(input.pending()).toEqual([]);
  });
});
