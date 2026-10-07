import { describe, expect, it, vi } from "vitest";
import { Pointer, asPointerEvent, claimGestures } from "./pointer";

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
      pointerId: 0,
      device: "mouse",
      primary: true,
    });
  });

  it("reports the device the platform named", () => {
    for (const device of ["touch", "pen"] as const) {
      expect(
        asPointerEvent(at("pointerdown", 1, 1, { pointerType: device }))
          ?.device,
      ).toBe(device);
    }
    expect(
      asPointerEvent(at("pointerdown", 1, 1, { pointerType: "mouse" }))?.device,
    ).toBe("mouse");
  });

  it("marks a secondary pointer rather than dropping it", () => {
    expect(
      asPointerEvent(at("pointerdown", 4, 6, { isPrimary: false }))?.primary,
    ).toBe(false);
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
    expect(pointer.current()).toEqual({
      x: 400,
      y: 200,
      down: false,
      device: "mouse",
    });
  });

  it("carries the device a finger and a pen drove it with", () => {
    const target = new EventTarget();
    const pointer = new Pointer(target, half);
    target.dispatchEvent(at("pointerdown", 10, 10, { pointerType: "touch" }));
    expect(pointer.current().device).toBe("touch");
    expect(pointer.samples()[0]?.device).toBe("touch");
    target.dispatchEvent(at("pointerup", 10, 10, { pointerType: "touch" }));
    target.dispatchEvent(at("pointermove", 10, 10, { pointerType: "pen" }));
    expect(pointer.current().device).toBe("pen");
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

  it("leaves the reported pointer to the primary one", () => {
    const target = new EventTarget();
    const pointer = new Pointer(target, half);
    target.dispatchEvent(at("pointerdown", 100, 100, { pointerType: "touch" }));
    // A second finger resting on the screen: the sample is marked and the
    // reported position stays with the finger that is playing.
    target.dispatchEvent(
      at("pointerdown", 900, 900, {
        pointerType: "touch",
        isPrimary: false,
        pointerId: 7,
      }),
    );
    expect(pointer.current()).toMatchObject({ x: 50, y: 50, down: true });
    // Its press raises no edge at all, and a move it makes is marked so the
    // game can drop it.
    target.dispatchEvent(
      at("pointermove", 900, 900, {
        pointerType: "touch",
        isPrimary: false,
        pointerId: 7,
      }),
    );
    expect(pointer.samples().map((sample) => sample.primary)).toEqual([
      true,
      false,
    ]);
    expect(pointer.current()).toMatchObject({ x: 50, y: 50 });
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

  it("captures a press on the canvas, and lets it go on the release", () => {
    const target = new EventTarget();
    const capture = {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    } as unknown as HTMLElement;
    const pointer = new Pointer(target, half, capture);
    target.dispatchEvent(
      at("pointerdown", 10, 10, { pointerType: "touch", pointerId: 3 }),
    );
    expect(capture.setPointerCapture).toHaveBeenCalledWith(3);
    // A drag that leaves the canvas keeps delivering, because of the capture.
    target.dispatchEvent(at("pointermove", 4000, 10, { pointerId: 3 }));
    target.dispatchEvent(
      at("pointerup", 4000, 10, { pointerType: "touch", pointerId: 3 }),
    );
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(3);
    expect(pointer.samples().map((sample) => sample.type)).toEqual([
      "down",
      "move",
      "up",
    ]);
  });

  it("survives a capture the platform refuses", () => {
    const target = new EventTarget();
    const capture = {
      setPointerCapture: () => {
        throw new Error("the pointer has already ended");
      },
      releasePointerCapture: () => {},
    } as unknown as HTMLElement;
    const pointer = new Pointer(target, half, capture);
    expect(() => {
      target.dispatchEvent(at("pointerdown", 10, 10));
    }).not.toThrow();
    expect(pointer.current().down).toBe(true);
  });

  it("still records an edge while the fit is degenerate", () => {
    const target = new EventTarget();
    const pointer = new Pointer(target, () => null);
    target.dispatchEvent(at("pointerdown", 10, 10));
    expect(pointer.current()).toEqual({
      x: 0,
      y: 0,
      down: true,
      device: "mouse",
    });
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

describe("claimGestures", () => {
  /** An element carrying just the style and listener surface the claim reads. */
  function element(): HTMLElement & { listeners: string[] } {
    const listeners: string[] = [];
    return {
      listeners,
      style: {
        touchAction: "auto",
        userSelect: "auto",
        webkitUserSelect: "auto",
        webkitTapHighlightColor: "",
      },
      addEventListener: (name: string) => listeners.push(name),
      removeEventListener: (name: string) => {
        const index = listeners.indexOf(name);
        if (index >= 0) listeners.splice(index, 1);
      },
    } as unknown as HTMLElement & { listeners: string[] };
  }

  it("stops the browser taking a touch drag for a pan or a zoom", () => {
    const canvas = element();
    claimGestures(canvas);
    expect(canvas.style.touchAction).toBe("none");
    expect(canvas.style.userSelect).toBe("none");
  });

  it("swallows the context menu and the page's own scrolling", () => {
    const canvas = element();
    claimGestures(canvas);
    expect(canvas.listeners).toEqual(["contextmenu", "wheel"]);
  });

  it("gives every claim back", () => {
    const canvas = element();
    claimGestures(canvas)();
    expect(canvas.style.touchAction).toBe("auto");
    expect(canvas.style.userSelect).toBe("auto");
    expect(canvas.listeners).toEqual([]);
  });

  it("claims nothing off an element that carries no style", () => {
    expect(() => claimGestures({} as unknown as HTMLElement)()).not.toThrow();
  });
});
