// The pointer and the finger, as the runtime reads them.
//
// specs/ui.md gives the menus a mouse and touch as well as the keyboard, and this
// build stands on no engine, so this layer is its own work. What is checked here
// is the reading itself: a move, a press and the release that completes it, in
// logical units, each news for exactly one frame — and a press that is HELD
// across frames, because a confirm takes both of its edges and they may be frames
// apart.

import { describe, expect, it } from "vitest";
import { PointerInput, asPointerEvent, type PointerMap } from "./pointer";

/** A `PointerEvent`-shaped event: the reader takes the id and the position. */
class PointerEventLike extends Event {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;

  constructor(type: string, x: number, y: number, pointerId = 1) {
    super(type);
    this.clientX = x;
    this.clientY = y;
    this.pointerId = pointerId;
  }
}

/** The identity map: the fit is `src/viewport.ts`'s business, not this one's. */
const AS_IS: PointerMap = (x, y) => ({ x, y });

/** A map that refuses every point, as a canvas with no layout yet does. */
const NOWHERE: PointerMap = () => null;

function reader(): { target: EventTarget; pointer: PointerInput } {
  const target = new EventTarget();
  return { target, pointer: new PointerInput(target) };
}

function send(
  target: EventTarget,
  type: string,
  x: number,
  y: number,
  id = 1,
): void {
  target.dispatchEvent(new PointerEventLike(type, x, y, id));
}

describe("asPointerEvent", () => {
  it("takes anything carrying a position, whatever realm it came from", () => {
    expect(asPointerEvent(new PointerEventLike("pointerdown", 1, 2))).not.toBe(
      null,
    );
    expect(asPointerEvent(new Event("pointerdown"))).toBeNull();
  });
});

describe("PointerInput", () => {
  it("reports where the pointer moved, in the map's units", () => {
    const { target, pointer } = reader();
    send(target, "pointermove", 100, 200);
    expect(pointer.frame(AS_IS)).toEqual({
      moved: { x: 100, y: 200 },
      pressed: null,
      released: null,
    });
  });

  it("holds a press across frames and completes it on the release", () => {
    const { target, pointer } = reader();
    send(target, "pointerdown", 100, 200);
    expect(pointer.frame(AS_IS).pressed).toEqual({ x: 100, y: 200 });
    pointer.endFrame();

    expect(pointer.frame(AS_IS)).toEqual({
      moved: null,
      pressed: null,
      released: null,
    });

    send(target, "pointermove", 140, 260);
    send(target, "pointerup", 140, 260);
    expect(pointer.frame(AS_IS).released).toEqual({
      from: { x: 100, y: 200 },
      to: { x: 140, y: 260 },
    });
  });

  it("releases at the contact's last known position, as a finger's lift is", () => {
    // A touch lift carries no useful position of its own, so the contact's last
    // move is where it came up.
    const { target, pointer } = reader();
    send(target, "pointerdown", 100, 200);
    send(target, "pointermove", 300, 400);
    pointer.endFrame();
    send(target, "pointerup", 0, 0);
    expect(pointer.frame(AS_IS).released).toEqual({
      from: { x: 100, y: 200 },
      to: { x: 300, y: 400 },
    });
  });

  it("completes only the press it is holding, whatever else came up", () => {
    const { target, pointer } = reader();
    send(target, "pointerdown", 100, 200, 1);
    pointer.endFrame();
    send(target, "pointerup", 500, 500, 2); // another contact entirely
    expect(pointer.frame(AS_IS).released).toBeNull();

    send(target, "pointerup", 100, 200, 1);
    expect(pointer.frame(AS_IS).released).not.toBeNull();
  });

  it("forgets a press on request", () => {
    const { target, pointer } = reader();
    send(target, "pointerdown", 100, 200);
    pointer.forget();
    pointer.endFrame();
    send(target, "pointerup", 100, 200);
    expect(pointer.frame(AS_IS).released).toBeNull();
  });

  it("drops a press the device cancelled", () => {
    const { target, pointer } = reader();
    send(target, "pointerdown", 100, 200);
    send(target, "pointercancel", 100, 200);
    pointer.endFrame();
    send(target, "pointerup", 100, 200);
    expect(pointer.frame(AS_IS).released).toBeNull();
  });

  it("keeps a press through another contact's cancel", () => {
    const { target, pointer } = reader();
    send(target, "pointerdown", 100, 200, 1);
    send(target, "pointercancel", 0, 0, 2);
    pointer.endFrame();
    send(target, "pointerup", 100, 200, 1);
    expect(pointer.frame(AS_IS).released).not.toBeNull();
  });

  it("reports nothing while no fit maps its points", () => {
    const { target, pointer } = reader();
    send(target, "pointermove", 100, 200);
    send(target, "pointerdown", 100, 200);
    send(target, "pointerup", 100, 200);
    expect(pointer.frame(NOWHERE)).toEqual({
      moved: null,
      pressed: null,
      released: null,
    });
  });

  it("ignores an event carrying no position at all", () => {
    const { target, pointer } = reader();
    target.dispatchEvent(new Event("pointerdown"));
    target.dispatchEvent(new Event("pointermove"));
    target.dispatchEvent(new Event("pointerup"));
    target.dispatchEvent(new Event("pointercancel"));
    expect(pointer.frame(AS_IS)).toEqual({
      moved: null,
      pressed: null,
      released: null,
    });
  });

  it("stops listening once detached, twice over if asked", () => {
    const { target, pointer } = reader();
    pointer.detach();
    pointer.detach();
    send(target, "pointermove", 100, 200);
    expect(pointer.frame(AS_IS).moved).toBeNull();
  });
});
