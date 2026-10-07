// The keyboard beneath the game.
//
// The registry answers two questions and no more: is the intent being asked for
// right now, and did it go down since the last tick. Both are checked against
// real key events dispatched at a target of the test's own, which is the same
// route a browser automation driver's key edges take.

import { beforeEach, describe, expect, it } from "vitest";
import { BINDINGS } from "./constants";
import { Keyboard, asKeyboardEvent } from "./keyboard";

/** A `KeyboardEvent`-shaped event: the keyboard reads `code` and `repeat`. */
class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

let target: EventTarget;
let keyboard: Keyboard;

beforeEach(() => {
  target = new EventTarget();
  keyboard = new Keyboard(target);
  for (const [action, keys] of Object.entries(BINDINGS)) {
    keyboard.register(action, keys);
  }
});

const down = (code: string, repeat = false): void => {
  target.dispatchEvent(new KeyEvent("keydown", code, repeat));
};
const up = (code: string): void => {
  target.dispatchEvent(new KeyEvent("keyup", code));
};

describe("reading an intent", () => {
  it("holds an intent while one of its keys is down", () => {
    expect(keyboard.value("up")).toBe(0);
    down("ArrowUp");
    expect(keyboard.value("up")).toBe(1);
    up("ArrowUp");
    expect(keyboard.value("up")).toBe(0);
  });

  it("answers zero for an intent nothing registered", () => {
    expect(keyboard.value("fly")).toBe(0);
    expect(keyboard.pressed("fly")).toBe(false);
  });

  it("arms one edge a press, consumed by the first read", () => {
    down("Enter");
    expect(keyboard.pressed("confirm")).toBe(true);
    expect(keyboard.pressed("confirm")).toBe(false);
  });

  it("discards an edge nothing read, so a press is news for one tick", () => {
    down("Enter");
    keyboard.endTick();
    expect(keyboard.pressed("confirm")).toBe(false);
  });

  it("ignores the platform's own auto-repeat", () => {
    down("ArrowUp");
    expect(keyboard.pressed("up")).toBe(true);
    down("ArrowUp", true);
    expect(keyboard.pressed("up")).toBe(false);
    expect(keyboard.value("up")).toBe(1);
  });

  it("arms a second edge only once the intent has come back to rest", () => {
    down("ArrowUp");
    expect(keyboard.pressed("up")).toBe(true);
    down("KeyW");
    expect(keyboard.pressed("up")).toBe(false);
    up("ArrowUp");
    expect(keyboard.value("up")).toBe(1);
    up("KeyW");
    expect(keyboard.value("up")).toBe(0);
    down("KeyW");
    expect(keyboard.pressed("up")).toBe(true);
  });
});

describe("the bindings", () => {
  it("drives one intent from either of its keys", () => {
    for (const [action, keys] of Object.entries(BINDINGS)) {
      for (const code of keys) {
        down(code);
        expect(keyboard.value(action), `${action} by ${code}`).toBe(1);
        up(code);
        keyboard.endTick();
      }
    }
  });

  it("drives both intents a shared key is bound to", () => {
    down("Escape");
    expect(keyboard.value("back")).toBe(1);
    expect(keyboard.value("pause")).toBe(1);
    expect(keyboard.pressed("back")).toBe(true);
    expect(keyboard.pressed("pause")).toBe(true);
  });

  it("answers nothing for a key bound to no intent", () => {
    down("KeyZ");
    for (const action of Object.keys(BINDINGS)) {
      expect(keyboard.value(action)).toBe(0);
      expect(keyboard.pressed(action)).toBe(false);
    }
  });

  it("replaces a binding wholesale, returning the intent to rest", () => {
    down("ArrowUp");
    expect(keyboard.value("up")).toBe(1);
    keyboard.register("up", ["KeyI"]);
    expect(keyboard.value("up")).toBe(0);
    down("ArrowUp");
    expect(keyboard.value("up")).toBe(0);
    down("KeyI");
    expect(keyboard.value("up")).toBe(1);
  });
});

describe("detaching", () => {
  it("stops listening, and does so once however often it is asked", () => {
    keyboard.detach();
    keyboard.detach();
    down("ArrowUp");
    expect(keyboard.value("up")).toBe(0);
  });
});

describe("narrowing an event", () => {
  it("takes anything carrying a code, and nothing else", () => {
    expect(asKeyboardEvent(new KeyEvent("keydown", "KeyA"))).not.toBeNull();
    expect(asKeyboardEvent(new Event("keydown"))).toBeNull();
  });
});
