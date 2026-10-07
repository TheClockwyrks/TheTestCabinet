import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  BINDINGS,
  Keyboard,
  OVERLAY_KEY,
  actionForCode,
} from "./input";

/** A minimal stand-in for the keydown events the page delivers. */
function keydown(code: string, repeat = false): Event {
  const event = new Event("keydown") as Event & {
    code: string;
    repeat: boolean;
  };
  Object.defineProperty(event, "code", { value: code });
  Object.defineProperty(event, "repeat", { value: repeat });
  return event;
}

describe("bindings", () => {
  it("binds every action", () => {
    for (const action of ACTIONS) {
      expect(BINDINGS[action].length).toBeGreaterThan(0);
    }
  });

  it("binds each key to one action only", () => {
    const codes = ACTIONS.flatMap((action) => [...BINDINGS[action]]);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("makes the two direction key sets interchangeable", () => {
    expect(actionForCode("ArrowUp")).toBe("up");
    expect(actionForCode("KeyW")).toBe("up");
    expect(actionForCode("ArrowRight")).toBe("right");
    expect(actionForCode("KeyD")).toBe("right");
  });

  it("names no action for an unbound key", () => {
    expect(actionForCode("KeyZ")).toBeNull();
  });
});

describe("Keyboard", () => {
  it("raises one edge per action per drain", () => {
    const target = new EventTarget();
    const keyboard = new Keyboard();
    keyboard.attach(target);
    target.dispatchEvent(keydown("ArrowUp"));
    target.dispatchEvent(keydown("KeyW"));
    target.dispatchEvent(keydown("ArrowLeft"));
    expect(keyboard.drain()).toEqual(["up", "left"]);
    expect(keyboard.drain()).toEqual([]);
    keyboard.release();
  });

  it("raises nothing for an auto-repeat", () => {
    const target = new EventTarget();
    const keyboard = new Keyboard();
    keyboard.attach(target);
    target.dispatchEvent(keydown("ArrowDown", true));
    expect(keyboard.drain()).toEqual([]);
    keyboard.release();
  });

  it("reports the overlay key apart from the actions", () => {
    const target = new EventTarget();
    const keyboard = new Keyboard();
    keyboard.attach(target);
    target.dispatchEvent(keydown(OVERLAY_KEY));
    expect(keyboard.drain()).toEqual([]);
    expect(keyboard.drainOverlayToggles()).toBe(1);
    expect(keyboard.drainOverlayToggles()).toBe(0);
    keyboard.release();
  });

  it("runs the first-press handler once", () => {
    const target = new EventTarget();
    const keyboard = new Keyboard();
    let calls = 0;
    keyboard.onFirstPress(() => {
      calls += 1;
    });
    keyboard.attach(target);
    target.dispatchEvent(keydown("KeyM"));
    target.dispatchEvent(keydown("KeyP"));
    expect(calls).toBe(1);
    keyboard.release();
  });

  it("stops listening once released", () => {
    const target = new EventTarget();
    const keyboard = new Keyboard();
    keyboard.attach(target);
    keyboard.release();
    target.dispatchEvent(keydown("ArrowUp"));
    expect(keyboard.drain()).toEqual([]);
  });
});
