// The keyboard registry: named actions over key codes, with consume-on-read
// edges. Events are dispatched at a bare EventTarget, which is exactly how the
// runtime holds it — the registry never asks what the target is.

import { describe, expect, it } from "vitest";
import { Keyboard, asKeyboardEvent } from "./keyboard";

class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

function keyboard(): { target: EventTarget; keys: Keyboard } {
  const target = new EventTarget();
  const keys = new Keyboard(target);
  keys.register("confirm", ["Enter", "Space"]);
  keys.register("back", ["Escape"]);
  return { target, keys };
}

describe("edges", () => {
  it("arms an edge on keydown and consumes it on the first read", () => {
    const { target, keys } = keyboard();
    target.dispatchEvent(new KeyEvent("keydown", "Enter"));
    expect(keys.pressed("confirm")).toBe(true);
    expect(keys.pressed("confirm")).toBe(false);
  });

  it("discards an unread edge at the end of the frame", () => {
    const { target, keys } = keyboard();
    target.dispatchEvent(new KeyEvent("keydown", "Enter"));
    keys.endFrame();
    expect(keys.pressed("confirm")).toBe(false);
  });

  it("ignores OS auto-repeat: the key never came up", () => {
    const { target, keys } = keyboard();
    target.dispatchEvent(new KeyEvent("keydown", "Enter"));
    expect(keys.pressed("confirm")).toBe(true);
    target.dispatchEvent(new KeyEvent("keydown", "Enter", true));
    expect(keys.pressed("confirm")).toBe(false);
  });

  it("re-arms only after every bound code has come up", () => {
    const { target, keys } = keyboard();
    target.dispatchEvent(new KeyEvent("keydown", "Enter"));
    expect(keys.pressed("confirm")).toBe(true);
    // Space goes down while Enter is still held: the action never rested.
    target.dispatchEvent(new KeyEvent("keydown", "Space"));
    expect(keys.pressed("confirm")).toBe(false);
    target.dispatchEvent(new KeyEvent("keyup", "Enter"));
    target.dispatchEvent(new KeyEvent("keyup", "Space"));
    target.dispatchEvent(new KeyEvent("keydown", "Enter"));
    expect(keys.pressed("confirm")).toBe(true);
  });

  it("reads an unregistered action as false rather than throwing", () => {
    const { keys } = keyboard();
    expect(keys.pressed("no-such-action")).toBe(false);
  });
});

describe("bindings", () => {
  it("drives one action from any of its codes", () => {
    const { target, keys } = keyboard();
    target.dispatchEvent(new KeyEvent("keydown", "Space"));
    expect(keys.pressed("confirm")).toBe(true);
  });

  it("replaces a binding wholesale on re-register", () => {
    const { target, keys } = keyboard();
    keys.register("confirm", ["KeyZ"]);
    target.dispatchEvent(new KeyEvent("keydown", "Enter"));
    expect(keys.pressed("confirm")).toBe(false);
    target.dispatchEvent(new KeyEvent("keydown", "KeyZ"));
    expect(keys.pressed("confirm")).toBe(true);
  });

  it("stops listening once detached, and detaches idempotently", () => {
    const { target, keys } = keyboard();
    keys.detach();
    keys.detach();
    target.dispatchEvent(new KeyEvent("keydown", "Enter"));
    expect(keys.pressed("confirm")).toBe(false);
  });
});

describe("asKeyboardEvent", () => {
  it("narrows structurally, so a plain event carrying a code passes", () => {
    expect(asKeyboardEvent(new KeyEvent("keydown", "Enter"))).not.toBeNull();
    expect(asKeyboardEvent(new Event("keydown"))).toBeNull();
  });
});
