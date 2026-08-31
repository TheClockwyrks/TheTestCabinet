import { describe, expect, it } from "vitest";
import { Keyboard } from "./input";

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
