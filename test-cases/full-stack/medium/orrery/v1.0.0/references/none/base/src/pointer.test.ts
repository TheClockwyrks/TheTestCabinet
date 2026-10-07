import { describe, expect, it } from "vitest";

import {
  Pointer,
  asPointerEvent,
  claimGestures,
  type StageMap,
} from "./pointer";

function event(
  type: string,
  clientX: number,
  clientY: number,
  extra: Record<string, unknown> = {},
): Event {
  return Object.assign(new Event(type), {
    clientX,
    clientY,
    pointerId: 1,
    ...extra,
  });
}

/** A map that halves the client position, so a conversion is visible. */
const halve: StageMap = (x, y) => ({ x: x / 2, y: y / 2 });

describe("the pointer, in stage units (specs/controls.md)", () => {
  it("reports the position in logical units, with the press and release", () => {
    const target = new EventTarget();
    const pointer = new Pointer(target, halve);
    target.dispatchEvent(event("pointermove", 200, 100));
    expect(pointer.current()).toEqual({ x: 100, y: 50, down: false });
    target.dispatchEvent(event("pointerdown", 200, 100));
    expect(pointer.current().down).toBe(true);
    target.dispatchEvent(event("pointerup", 200, 100));
    expect(pointer.current().down).toBe(false);
    pointer.detach();
  });

  it("buffers every sample in arrival order, so a lay follows the pointer", () => {
    const target = new EventTarget();
    const pointer = new Pointer(target, halve);
    target.dispatchEvent(event("pointerdown", 0, 0));
    target.dispatchEvent(event("pointermove", 20, 0));
    target.dispatchEvent(event("pointermove", 40, 0));
    target.dispatchEvent(event("pointerup", 40, 0));
    expect(pointer.samples().map((sample) => [sample.type, sample.x])).toEqual([
      ["down", 0],
      ["move", 10],
      ["move", 20],
      ["up", 20],
    ]);
    expect(pointer.samples()).toEqual([]);
    pointer.detach();
  });

  it("does not repeat an edge for a second button or a duplicate event", () => {
    const target = new EventTarget();
    const pointer = new Pointer(target, halve);
    target.dispatchEvent(event("pointerdown", 0, 0));
    target.dispatchEvent(event("pointerdown", 0, 0));
    expect(pointer.samples().filter((s) => s.type === "down")).toHaveLength(1);
    pointer.detach();
  });

  it("treats a cancel as a release, so a drag never hangs", () => {
    const target = new EventTarget();
    const pointer = new Pointer(target, halve);
    target.dispatchEvent(event("pointerdown", 10, 10));
    pointer.samples();
    target.dispatchEvent(event("pointercancel", 10, 10));
    expect(pointer.samples().map((sample) => sample.type)).toEqual(["up"]);
    expect(pointer.current().down).toBe(false);
    pointer.detach();
  });

  it("captures the pointer on a press and releases it on the release", () => {
    const target = new EventTarget();
    const captured: string[] = [];
    const pointer = new Pointer(target, halve, {
      setPointerCapture: (id) => captured.push(`set ${id}`),
      releasePointerCapture: (id) => captured.push(`release ${id}`),
    });
    target.dispatchEvent(event("pointerdown", 0, 0));
    target.dispatchEvent(event("pointermove", 4, 0));
    target.dispatchEvent(event("pointerup", 4, 0));
    expect(captured).toEqual(["set 1", "release 1"]);
    pointer.detach();
  });

  it("survives a capture that the platform refuses", () => {
    const target = new EventTarget();
    const pointer = new Pointer(target, halve, {
      setPointerCapture: () => {
        throw new Error("gone");
      },
      releasePointerCapture: () => {
        throw new Error("gone");
      },
    });
    expect(() =>
      target.dispatchEvent(event("pointerdown", 0, 0)),
    ).not.toThrow();
    pointer.detach();
  });

  it("holds its last position while the fit is degenerate", () => {
    const target = new EventTarget();
    let live = true;
    const pointer = new Pointer(target, (x, y) => (live ? { x, y } : null));
    target.dispatchEvent(event("pointermove", 7, 9));
    live = false;
    target.dispatchEvent(event("pointerdown", 90, 90));
    expect(pointer.current()).toEqual({ x: 7, y: 9, down: true });
    pointer.detach();
  });

  it("ignores a non-primary pointer's position and edges", () => {
    const target = new EventTarget();
    const pointer = new Pointer(target, halve);
    target.dispatchEvent(event("pointerdown", 100, 100, { isPrimary: false }));
    expect(pointer.current().down).toBe(false);
    pointer.detach();
  });

  it("discards samples nothing consumed at the end of the frame", () => {
    const target = new EventTarget();
    const pointer = new Pointer(target, halve);
    target.dispatchEvent(event("pointermove", 2, 2));
    pointer.endFrame();
    expect(pointer.samples()).toEqual([]);
    pointer.detach();
  });

  it("reads a pointer event structurally, whatever realm it came from", () => {
    expect(asPointerEvent(event("pointermove", 1, 2))?.clientX).toBe(1);
    expect(asPointerEvent(new Event("pointermove"))).toBeNull();
  });
});

describe("claiming the browser's own gestures", () => {
  it("takes the canvas's touch, selection, and context-menu behavior back", () => {
    const listeners: string[] = [];
    const style: Record<string, string> = {
      touchAction: "auto",
      userSelect: "auto",
    };
    const element = {
      style,
      addEventListener: (name: string) => listeners.push(name),
      removeEventListener: (name: string) => listeners.push(`-${name}`),
    } as unknown as HTMLElement;
    const release = claimGestures(element);
    expect(style.touchAction).toBe("none");
    expect(style.userSelect).toBe("none");
    expect(listeners).toEqual(["contextmenu"]);
    release();
    expect(style.touchAction).toBe("auto");
    expect(listeners).toEqual(["contextmenu", "-contextmenu"]);
  });

  it("claims nothing from a canvas with no style and no listeners", () => {
    const bare = {} as unknown as HTMLElement;
    expect(() => claimGestures(bare)()).not.toThrow();
  });
});
