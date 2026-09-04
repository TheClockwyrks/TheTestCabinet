import { describe, expect, it } from "vitest";
import { Keyboard, Pointer, type StageMapping } from "./input";

/** A mapping that halves a client position, offset by the letterbox. */
const HALVED: StageMapping = {
  point: (x, y) => ({ x: x / 2 - 10, y: y / 2 - 20 }),
  travel: (delta) => delta / 2,
};

describe("the keyboard", () => {
  it("reports held values and one edge per press", () => {
    const keyboard = new Keyboard();
    expect(keyboard.keyDown("ArrowLeft", false)).toBe(true);
    expect(keyboard.held("left")).toBe(1);
    expect(keyboard.movement()).toEqual({ up: 0, down: 0, left: 1, right: 0 });
    expect(keyboard.drainEdges()).toEqual(["left"]);
    expect(keyboard.drainEdges()).toEqual([]);
    keyboard.keyUp("ArrowLeft");
    expect(keyboard.held("left")).toBe(0);
  });

  it("treats both bindings of an action alike and arms no edge on repeat", () => {
    const keyboard = new Keyboard();
    keyboard.keyDown("KeyW", false);
    keyboard.keyDown("KeyW", true);
    expect(keyboard.held("up")).toBe(1);
    expect(keyboard.drainEdges()).toEqual(["up"]);
    keyboard.keyDown("ArrowUp", false);
    expect(keyboard.drainEdges()).toEqual([]);
    keyboard.keyUp("KeyW");
    expect(keyboard.held("up")).toBe(1);
    keyboard.keyUp("ArrowUp");
    expect(keyboard.held("up")).toBe(0);
  });

  it("orders edges by action and ignores unbound keys", () => {
    const keyboard = new Keyboard();
    keyboard.keyDown("KeyM", false);
    keyboard.keyDown("Enter", false);
    keyboard.keyDown("KeyP", false);
    expect(keyboard.keyDown("KeyQ", false)).toBe(false);
    expect(keyboard.drainEdges()).toEqual(["confirm", "pause", "mute"]);
  });

  it("counts overlay toggles apart and calls the first-press hook once", () => {
    const keyboard = new Keyboard();
    let presses = 0;
    keyboard.onFirstPress(() => {
      presses += 1;
    });
    expect(keyboard.keyDown("Backquote", false)).toBe(true);
    keyboard.keyDown("Backquote", true);
    keyboard.keyDown("Backquote", false);
    expect(keyboard.drainOverlayToggles()).toBe(2);
    expect(keyboard.drainOverlayToggles()).toBe(0);
    expect(keyboard.drainEdges()).toEqual([]);
    keyboard.keyDown("Space", false);
    expect(presses).toBe(1);
  });

  it("listens on a target and releases every key on blur", () => {
    const keyboard = new Keyboard();
    const target = new EventTarget();
    keyboard.attach(target);
    target.dispatchEvent(
      Object.assign(new Event("keydown"), {
        code: "ArrowRight",
        repeat: false,
      }),
    );
    expect(keyboard.held("right")).toBe(1);
    target.dispatchEvent(new Event("blur"));
    expect(keyboard.held("right")).toBe(0);
    target.dispatchEvent(
      Object.assign(new Event("keydown"), { code: "KeyD", repeat: false }),
    );
    target.dispatchEvent(Object.assign(new Event("keyup"), { code: "KeyD" }));
    expect(keyboard.held("right")).toBe(0);
    keyboard.release();
    target.dispatchEvent(
      Object.assign(new Event("keydown"), { code: "KeyD", repeat: false }),
    );
    expect(keyboard.held("right")).toBe(0);
  });
});

describe("the pointer", () => {
  it("reports where it rests, mapped into stage units", () => {
    const pointer = new Pointer();
    expect(pointer.drain(HALVED).at).toBeNull();
    pointer.moveTo(400, 200);
    expect(pointer.drain(HALVED).at).toEqual({ x: 190, y: 80 });
    // A resting pointer keeps hovering, frame after frame.
    expect(pointer.drain(HALVED).at).toEqual({ x: 190, y: 80 });
    pointer.leave();
    expect(pointer.drain(HALVED).at).toBeNull();
  });

  it("keeps each primary press in order and drains them once", () => {
    const pointer = new Pointer();
    pointer.pressAt(100, 100);
    pointer.pressAt(200, 100);
    expect(pointer.drain(HALVED).presses).toEqual([
      { x: 40, y: 30 },
      { x: 90, y: 30 },
    ]);
    expect(pointer.drain(HALVED).presses).toEqual([]);
  });

  it("sums a frame's wheel travel and drains it once", () => {
    const pointer = new Pointer();
    pointer.roll(120);
    pointer.roll(-40);
    expect(pointer.drain(HALVED).wheel).toBe(40);
    expect(pointer.drain(HALVED).wheel).toBe(0);
  });

  it("listens on a target for moves, primary presses, the wheel, and leaving", () => {
    const pointer = new Pointer();
    const target = new EventTarget();
    pointer.attach(target);
    target.dispatchEvent(
      Object.assign(new Event("pointermove"), { clientX: 60, clientY: 80 }),
    );
    target.dispatchEvent(
      Object.assign(new Event("pointerdown"), {
        clientX: 60,
        clientY: 80,
        button: 0,
      }),
    );
    target.dispatchEvent(
      Object.assign(new Event("pointerdown"), {
        clientX: 20,
        clientY: 20,
        button: 2,
      }),
    );
    target.dispatchEvent(
      Object.assign(new Event("wheel"), {
        deltaY: 100,
        preventDefault: () => {},
      }),
    );
    const frame = pointer.drain(HALVED);
    // The secondary press moved the pointer and armed nothing.
    expect(frame.at).toEqual({ x: 0, y: -10 });
    expect(frame.presses).toEqual([{ x: 20, y: 20 }]);
    expect(frame.wheel).toBe(50);
    target.dispatchEvent(new Event("pointerleave"));
    expect(pointer.drain(HALVED).at).toBeNull();
    pointer.release();
    target.dispatchEvent(
      Object.assign(new Event("pointermove"), { clientX: 60, clientY: 80 }),
    );
    expect(pointer.drain(HALVED).at).toBeNull();
  });
});
