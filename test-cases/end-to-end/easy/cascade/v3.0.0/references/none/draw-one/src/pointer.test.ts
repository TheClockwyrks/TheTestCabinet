import { describe, expect, it } from "vitest";
import { Pointer, asPointerEvent, type StageMap } from "./pointer";

/** A tiny event target, so the tests need no DOM. */
class Target implements EventTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener | null): void {
    if (listener === null) return;
    const set = this.listeners.get(type) ?? new Set<EventListener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: EventListener | null): void {
    if (listener === null) return;
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    for (const listener of this.listeners.get(event.type) ?? [])
      listener(event);
    return true;
  }

  /** Send a pointer-shaped event of `type` at a client position. */
  send(type: string, clientX: number, clientY: number, isPrimary = true): void {
    this.dispatchEvent(
      Object.assign(new Event(type), { clientX, clientY, isPrimary }),
    );
  }
}

const identity: StageMap = (clientX, clientY) => ({ x: clientX, y: clientY });

describe("the pointer", () => {
  it("reports every sample of a frame in the order it arrived", () => {
    const target = new Target();
    const pointer = new Pointer(target, identity);
    target.send("pointerdown", 10, 20);
    target.send("pointermove", 30, 40);
    target.send("pointerup", 50, 60);
    expect(pointer.samples()).toEqual([
      { type: "down", x: 10, y: 20 },
      { type: "move", x: 30, y: 40 },
      { type: "up", x: 50, y: 60 },
    ]);
    expect(pointer.samples()).toEqual([]);
  });

  it("tracks where the pointer is and whether it is pressed", () => {
    const target = new Target();
    const pointer = new Pointer(target, identity);
    expect(pointer.current()).toEqual({ x: 0, y: 0, down: false });
    target.send("pointerdown", 7, 8);
    expect(pointer.current()).toEqual({ x: 7, y: 8, down: true });
    target.send("pointerup", 9, 10);
    expect(pointer.current()).toEqual({ x: 9, y: 10, down: false });
  });

  it("does not repeat an edge, and ignores a non-primary touch", () => {
    const target = new Target();
    const pointer = new Pointer(target, identity);
    target.send("pointerdown", 1, 1);
    target.send("pointerdown", 2, 2);
    target.send("pointerdown", 3, 3, false);
    expect(pointer.samples()).toEqual([{ type: "down", x: 1, y: 1 }]);
  });

  it("treats a cancel as a release", () => {
    const target = new Target();
    const pointer = new Pointer(target, identity);
    target.send("pointerdown", 1, 1);
    pointer.samples();
    target.send("pointercancel", 4, 4);
    expect(pointer.samples()).toEqual([{ type: "up", x: 4, y: 4 }]);
  });

  it("keeps its last position while the fit has no answer", () => {
    const target = new Target();
    const pointer = new Pointer(target, (x, y) => (x < 0 ? null : { x, y }));
    target.send("pointermove", 12, 13);
    pointer.samples();
    target.send("pointerdown", -1, -1);
    expect(pointer.samples()).toEqual([{ type: "down", x: 12, y: 13 }]);
  });

  it("discards what no frame consumed, and drops its listeners once", () => {
    const target = new Target();
    const pointer = new Pointer(target, identity);
    target.send("pointermove", 1, 1);
    pointer.endFrame();
    expect(pointer.samples()).toEqual([]);
    pointer.detach();
    pointer.detach();
    target.send("pointermove", 2, 2);
    expect(pointer.samples()).toEqual([]);
  });

  it("narrows only an event carrying client coordinates", () => {
    expect(asPointerEvent(new Event("pointerdown"))).toBeNull();
    expect(
      asPointerEvent(
        Object.assign(new Event("pointerdown"), { clientX: 1, clientY: 2 }),
      ),
    ).toEqual({ clientX: 1, clientY: 2 });
  });
});
