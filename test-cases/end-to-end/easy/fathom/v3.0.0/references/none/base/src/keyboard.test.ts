import { beforeEach, describe, expect, it } from "vitest";

import { BINDINGS } from "./constants";
import { asKeyboardEvent, Keyboard } from "./keyboard";

/** A minimal event target, which is all the keyboard reads the DOM through. */
function target(): EventTarget {
  return new EventTarget();
}

function key(type: string, code: string, repeat = false): Event {
  return Object.assign(new Event(type), { code, repeat });
}

describe("asKeyboardEvent", () => {
  it("accepts anything carrying a code, whatever realm it came from", () => {
    expect(asKeyboardEvent(key("keydown", "KeyM"))).not.toBeNull();
  });

  it("rejects an event with no code", () => {
    expect(asKeyboardEvent(new Event("keydown"))).toBeNull();
  });
});

describe("Keyboard", () => {
  let events: EventTarget;
  let keyboard: Keyboard;

  beforeEach(() => {
    events = target();
    keyboard = new Keyboard(events);
    for (const [action, codes] of Object.entries(BINDINGS)) {
      keyboard.register(action, codes);
    }
  });

  it("reads an action as held between its keydown and its keyup", () => {
    expect(keyboard.value("left")).toBe(0);
    events.dispatchEvent(key("keydown", "ArrowLeft"));
    expect(keyboard.value("left")).toBe(1);
    events.dispatchEvent(key("keyup", "ArrowLeft"));
    expect(keyboard.value("left")).toBe(0);
  });

  it("holds an action until the last of its bound keys comes up", () => {
    events.dispatchEvent(key("keydown", "ArrowLeft"));
    events.dispatchEvent(key("keydown", "KeyA"));
    events.dispatchEvent(key("keyup", "ArrowLeft"));
    expect(keyboard.value("left")).toBe(1);
    events.dispatchEvent(key("keyup", "KeyA"));
    expect(keyboard.value("left")).toBe(0);
  });

  it("arms one edge per press, consumed by the first reader", () => {
    events.dispatchEvent(key("keydown", "Space"));
    expect(keyboard.pressed("a")).toBe(true);
    expect(keyboard.pressed("a")).toBe(false);
  });

  it("drives every action one key is bound to", () => {
    events.dispatchEvent(key("keydown", "Space"));
    expect(keyboard.pressed("a")).toBe(true);
    expect(keyboard.pressed("confirm")).toBe(true);
    events.dispatchEvent(key("keydown", "Escape"));
    expect(keyboard.pressed("back")).toBe(true);
    expect(keyboard.pressed("pause")).toBe(true);
  });

  it("ignores an operating system auto-repeat, which is not a fresh press", () => {
    events.dispatchEvent(key("keydown", "KeyP"));
    expect(keyboard.pressed("pause")).toBe(true);
    events.dispatchEvent(key("keydown", "KeyP", true));
    expect(keyboard.pressed("pause")).toBe(false);
  });

  it("discards an edge nothing consumed at the end of the tick", () => {
    events.dispatchEvent(key("keydown", "KeyM"));
    keyboard.endTick();
    expect(keyboard.pressed("mute")).toBe(false);
  });

  it("lets every key up when the page loses focus", () => {
    events.dispatchEvent(key("keydown", "ArrowUp"));
    events.dispatchEvent(new Event("blur"));
    expect(keyboard.value("up")).toBe(0);
  });

  it("reads an action nothing registered as at rest", () => {
    expect(keyboard.value("nonesuch")).toBe(0);
    expect(keyboard.pressed("nonesuch")).toBe(false);
  });

  it("returns an action to rest when its binding is replaced", () => {
    events.dispatchEvent(key("keydown", "ArrowUp"));
    keyboard.register("up", ["KeyI"]);
    expect(keyboard.value("up")).toBe(0);
    events.dispatchEvent(key("keydown", "ArrowUp"));
    expect(keyboard.value("up")).toBe(0);
    events.dispatchEvent(key("keydown", "KeyI"));
    expect(keyboard.value("up")).toBe(1);
  });

  it("hears nothing once it is detached, twice over", () => {
    keyboard.detach();
    keyboard.detach();
    events.dispatchEvent(key("keydown", "ArrowDown"));
    expect(keyboard.value("down")).toBe(0);
  });
});
