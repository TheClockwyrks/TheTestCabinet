// The keyboard: named actions, read as press edges.
//
// Every action in Meltdown is a one-shot (specs/controls.md), so what matters
// here is that a press is news exactly once — consumed by the first reader,
// dropped at the end of its frame, and not repeated by an OS auto-repeat.

import { describe, expect, it } from "vitest";
import { ACTIONS, BINDINGS } from "./constants";
import { Keyboard, asKeyboardEvent } from "./keyboard";

/** A `KeyboardEvent`-shaped event: the keyboard reads `code` and `repeat`. */
class KeyEvent extends Event {
  constructor(
    type: "keydown" | "keyup",
    readonly code: string,
    readonly repeat = false,
  ) {
    super(type);
  }
}

function bench() {
  const target = new EventTarget();
  const keyboard = new Keyboard(target);
  for (const action of ACTIONS) keyboard.register(action, BINDINGS[action]);
  return {
    keyboard,
    down: (code: string, repeat = false) =>
      target.dispatchEvent(new KeyEvent("keydown", code, repeat)),
    up: (code: string) => target.dispatchEvent(new KeyEvent("keyup", code)),
    target,
  };
}

describe("narrowing an event", () => {
  it("takes anything carrying a code, whatever realm it came from", () => {
    expect(asKeyboardEvent(new KeyEvent("keydown", "KeyP"))).not.toBeNull();
    expect(asKeyboardEvent(new Event("keydown"))).toBeNull();
  });
});

describe("the edge", () => {
  it("reports a press once and consumes it", () => {
    const b = bench();
    b.down("KeyP");
    expect(b.keyboard.pressed("pause")).toBe(true);
    expect(b.keyboard.pressed("pause")).toBe(false);
  });

  it("fires once however long the key is held", () => {
    const b = bench();
    b.down("KeyP");
    expect(b.keyboard.pressed("pause")).toBe(true);
    b.keyboard.endFrame();
    // An OS auto-repeat is not a new press.
    b.down("KeyP", true);
    b.down("KeyP");
    expect(b.keyboard.pressed("pause")).toBe(false);
  });

  it("arms again after the key comes up and goes down once more", () => {
    const b = bench();
    b.down("KeyP");
    b.keyboard.pressed("pause");
    b.keyboard.endFrame();
    b.up("KeyP");
    b.down("KeyP");
    expect(b.keyboard.pressed("pause")).toBe(true);
  });

  it("is discarded at the end of the frame it was armed in", () => {
    const b = bench();
    b.down("Space");
    b.keyboard.endFrame();
    expect(b.keyboard.pressed("send")).toBe(false);
  });

  it("still reports the key as held after its edge was consumed", () => {
    const b = bench();
    b.down("KeyR");
    b.keyboard.pressed("rotate");
    expect(b.keyboard.held("rotate")).toBe(true);
    b.up("KeyR");
    expect(b.keyboard.held("rotate")).toBe(false);
  });
});

describe("the bindings", () => {
  it("reaches every action the game registers", () => {
    const b = bench();
    for (const action of ACTIONS) {
      for (const code of BINDINGS[action]) {
        b.down(code);
        expect(b.keyboard.pressed(action)).toBe(true);
        b.keyboard.endFrame();
        b.up(code);
      }
    }
  });

  it("drives no two actions from one key", () => {
    const seen = new Map<string, string>();
    for (const action of ACTIONS) {
      for (const code of BINDINGS[action]) {
        expect(seen.has(code)).toBe(false);
        seen.set(code, action);
      }
    }
  });

  it("ignores a key nothing is bound to", () => {
    const b = bench();
    b.down("KeyZ");
    for (const action of ACTIONS) expect(b.keyboard.pressed(action)).toBe(false);
  });

  it("reads an unregistered name as false rather than throwing", () => {
    const b = bench();
    expect(b.keyboard.pressed("no-such-action")).toBe(false);
    expect(b.keyboard.held("no-such-action")).toBe(false);
  });

  it("replaces a binding wholesale, returning the action to rest", () => {
    const b = bench();
    b.down("KeyP");
    b.keyboard.register("pause", ["KeyQ"]);
    expect(b.keyboard.held("pause")).toBe(false);
    b.down("KeyP");
    expect(b.keyboard.pressed("pause")).toBe(false);
    b.down("KeyQ");
    expect(b.keyboard.pressed("pause")).toBe(true);
  });
});

describe("detaching", () => {
  it("stops listening, and is idempotent because teardown races", () => {
    const b = bench();
    b.keyboard.detach();
    b.keyboard.detach();
    b.down("KeyP");
    expect(b.keyboard.pressed("pause")).toBe(false);
  });
});
