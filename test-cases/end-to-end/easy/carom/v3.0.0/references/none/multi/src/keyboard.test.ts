// The action registry. What is checked here is the part of input handling that is
// easy to get subtly wrong and impossible to see by playing: which press counts as
// an edge, who gets to consume it, and when it goes away.

import { beforeEach, describe, expect, it } from "vitest";
import { ACTIONS, BINDINGS } from "./constants";
import { Keyboard, asKeyboardEvent } from "./keyboard";

/** A `KeyboardEvent`-shaped event: the registry reads `code` and `repeat`. */
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

const down = (code: string, repeat = false): void => {
  target.dispatchEvent(new KeyEvent("keydown", code, repeat));
};
const up = (code: string): void => {
  target.dispatchEvent(new KeyEvent("keyup", code));
};
const tap = (code: string): void => {
  down(code);
  up(code);
};

beforeEach(() => {
  target = new EventTarget();
  keyboard = new Keyboard(target);
});

describe("holding", () => {
  it("reports an action as held while one of its keys is down", () => {
    keyboard.register("p1-up", ["KeyW"]);
    expect(keyboard.value("p1-up")).toBe(0);
    down("KeyW");
    expect(keyboard.value("p1-up")).toBe(1);
    up("KeyW");
    expect(keyboard.value("p1-up")).toBe(0);
  });

  it("stays held until the LAST of its keys comes up", () => {
    keyboard.register("confirm", ["Enter", "Space"]);
    down("Enter");
    down("Space");
    up("Enter");
    expect(keyboard.value("confirm")).toBe(1);
    up("Space");
    expect(keyboard.value("confirm")).toBe(0);
  });

  it("drives every action a key is bound to", () => {
    // Escape is both `pause` and `back` in this game.
    keyboard.register("pause", ["KeyP", "Escape"]);
    keyboard.register("back", ["Escape"]);
    down("Escape");
    expect(keyboard.value("pause")).toBe(1);
    expect(keyboard.value("back")).toBe(1);
  });

  it("ignores a key nothing is bound to", () => {
    keyboard.register("p1-up", ["KeyW"]);
    down("KeyQ");
    expect(keyboard.value("p1-up")).toBe(0);
  });

  it("reads an unregistered action as at rest rather than throwing", () => {
    expect(keyboard.value("nonsense")).toBe(0);
    expect(keyboard.pressed("nonsense")).toBe(false);
  });
});

describe("edges", () => {
  it("arms an edge when the action leaves rest", () => {
    keyboard.register("confirm", ["Enter"]);
    expect(keyboard.pressed("confirm")).toBe(false);
    down("Enter");
    expect(keyboard.pressed("confirm")).toBe(true);
  });

  it("is consumed by the first reader, so one press is acted on once", () => {
    keyboard.register("confirm", ["Enter"]);
    down("Enter");
    expect(keyboard.pressed("confirm")).toBe(true);
    expect(keyboard.pressed("confirm")).toBe(false);
  });

  it("does not re-arm while the action is already held", () => {
    keyboard.register("confirm", ["Enter", "Space"]);
    down("Enter");
    expect(keyboard.pressed("confirm")).toBe(true);
    down("Space");
    expect(keyboard.pressed("confirm")).toBe(false);
  });

  it("re-arms once the action has returned to rest", () => {
    keyboard.register("confirm", ["Enter"]);
    tap("Enter");
    expect(keyboard.pressed("confirm")).toBe(true);
    tap("Enter");
    expect(keyboard.pressed("confirm")).toBe(true);
  });

  it("treats an OS auto-repeat as no press at all: the key never came up", () => {
    keyboard.register("confirm", ["Enter"]);
    down("Enter");
    expect(keyboard.pressed("confirm")).toBe(true);
    down("Enter", true);
    expect(keyboard.pressed("confirm")).toBe(false);
    expect(keyboard.value("confirm")).toBe(1);
  });

  it("discards an edge nothing consumed at the end of its frame", () => {
    keyboard.register("confirm", ["Enter"]);
    down("Enter");
    keyboard.endFrame();
    expect(keyboard.pressed("confirm")).toBe(false);
  });

  it("survives a keyup that arrives after the frame the press belonged to", () => {
    keyboard.register("confirm", ["Enter"]);
    down("Enter");
    expect(keyboard.pressed("confirm")).toBe(true);
    keyboard.endFrame();
    up("Enter");
    expect(keyboard.value("confirm")).toBe(0);
    expect(keyboard.pressed("confirm")).toBe(false);
  });
});

describe("rebinding", () => {
  it("replaces the binding wholesale rather than adding to it", () => {
    keyboard.register("p1-up", ["KeyW"]);
    keyboard.register("p1-up", ["ArrowUp"]);
    down("KeyW");
    expect(keyboard.value("p1-up")).toBe(0);
    down("ArrowUp");
    expect(keyboard.value("p1-up")).toBe(1);
  });

  it("returns the action to rest, so no key is left stranded down", () => {
    keyboard.register("p1-up", ["KeyW"]);
    down("KeyW");
    keyboard.register("p1-up", ["KeyW"]);
    expect(keyboard.value("p1-up")).toBe(0);
  });
});

describe("the bindings this game registers", () => {
  it("gives every action in ACTIONS a key that drives it", () => {
    for (const action of ACTIONS) keyboard.register(action, BINDINGS[action]);
    for (const action of ACTIONS) {
      for (const code of BINDINGS[action]) {
        down(code);
        expect(keyboard.value(action)).toBe(1);
        up(code);
        expect(keyboard.value(action)).toBe(0);
      }
      keyboard.endFrame();
    }
  });
});

describe("detaching", () => {
  it("stops listening, and is idempotent because teardown races", () => {
    keyboard.register("p1-up", ["KeyW"]);
    keyboard.detach();
    keyboard.detach();
    down("KeyW");
    expect(keyboard.value("p1-up")).toBe(0);
  });
});

describe("asKeyboardEvent", () => {
  it("accepts anything carrying a code, whatever realm it came from", () => {
    expect(asKeyboardEvent(new KeyEvent("keydown", "KeyW"))).not.toBeNull();
    expect(asKeyboardEvent(new Event("keydown"))).toBeNull();
  });
});
