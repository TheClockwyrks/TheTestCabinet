import { describe, expect, it } from "vitest";
import { Keyboard, asKeyboardEvent } from "./keyboard";

/** A key event that carries only what the keyboard reads off one. */
function key(type: "keydown" | "keyup", code: string, repeat = false): Event {
  return Object.assign(new Event(type), { code, repeat });
}

describe("asKeyboardEvent", () => {
  it("narrows anything carrying a code, whatever realm it came from", () => {
    expect(asKeyboardEvent(key("keydown", "KeyM"))?.code).toBe("KeyM");
  });

  it("rejects an event with no code", () => {
    expect(asKeyboardEvent(new Event("keydown"))).toBeNull();
  });
});

describe("Keyboard", () => {
  it("arms an edge on the frame a bound key goes down", () => {
    const target = new EventTarget();
    const keyboard = new Keyboard(target);
    keyboard.register("confirm", ["Enter"]);
    target.dispatchEvent(key("keydown", "Enter"));
    expect(keyboard.pressed("confirm")).toBe(true);
  });

  it("consumes the edge, so one press is acted on once", () => {
    const target = new EventTarget();
    const keyboard = new Keyboard(target);
    keyboard.register("confirm", ["Enter"]);
    target.dispatchEvent(key("keydown", "Enter"));
    expect(keyboard.pressed("confirm")).toBe(true);
    expect(keyboard.pressed("confirm")).toBe(false);
  });

  it("discards an edge nothing read at the end of its frame", () => {
    const target = new EventTarget();
    const keyboard = new Keyboard(target);
    keyboard.register("pause", ["KeyP"]);
    target.dispatchEvent(key("keydown", "KeyP"));
    keyboard.endFrame();
    expect(keyboard.pressed("pause")).toBe(false);
  });

  it("ignores an OS auto-repeat, which is not a new press", () => {
    const target = new EventTarget();
    const keyboard = new Keyboard(target);
    keyboard.register("down", ["ArrowDown"]);
    target.dispatchEvent(key("keydown", "ArrowDown"));
    keyboard.pressed("down");
    target.dispatchEvent(key("keydown", "ArrowDown", true));
    expect(keyboard.pressed("down")).toBe(false);
  });

  it("re-arms once the key has come up and gone down again", () => {
    const target = new EventTarget();
    const keyboard = new Keyboard(target);
    keyboard.register("down", ["ArrowDown"]);
    target.dispatchEvent(key("keydown", "ArrowDown"));
    keyboard.pressed("down");
    keyboard.endFrame();
    target.dispatchEvent(key("keyup", "ArrowDown"));
    target.dispatchEvent(key("keydown", "ArrowDown"));
    expect(keyboard.pressed("down")).toBe(true);
  });

  it("does not re-arm while a second bound key is still held", () => {
    const target = new EventTarget();
    const keyboard = new Keyboard(target);
    keyboard.register("up", ["ArrowUp", "KeyW"]);
    target.dispatchEvent(key("keydown", "ArrowUp"));
    keyboard.pressed("up");
    keyboard.endFrame();
    target.dispatchEvent(key("keydown", "KeyW"));
    expect(keyboard.pressed("up")).toBe(false);
    target.dispatchEvent(key("keyup", "ArrowUp"));
    target.dispatchEvent(key("keyup", "KeyW"));
    target.dispatchEvent(key("keydown", "KeyW"));
    expect(keyboard.pressed("up")).toBe(true);
  });

  it("lets one code drive several actions", () => {
    const target = new EventTarget();
    const keyboard = new Keyboard(target);
    keyboard.register("confirm", ["Space"]);
    keyboard.register("jump", ["Space"]);
    target.dispatchEvent(key("keydown", "Space"));
    expect(keyboard.pressed("confirm")).toBe(true);
    expect(keyboard.pressed("jump")).toBe(true);
  });

  it("replaces a binding wholesale on re-registration", () => {
    const target = new EventTarget();
    const keyboard = new Keyboard(target);
    keyboard.register("mute", ["KeyM"]);
    keyboard.register("mute", ["KeyN"]);
    target.dispatchEvent(key("keydown", "KeyM"));
    expect(keyboard.pressed("mute")).toBe(false);
    target.dispatchEvent(key("keydown", "KeyN"));
    expect(keyboard.pressed("mute")).toBe(true);
  });

  it("reads an unregistered action as false rather than throwing", () => {
    const keyboard = new Keyboard(new EventTarget());
    expect(keyboard.pressed("nothing")).toBe(false);
  });

  it("stops listening once detached, and detaching twice is harmless", () => {
    const target = new EventTarget();
    const keyboard = new Keyboard(target);
    keyboard.register("confirm", ["Enter"]);
    keyboard.detach();
    keyboard.detach();
    target.dispatchEvent(key("keydown", "Enter"));
    expect(keyboard.pressed("confirm")).toBe(false);
  });
});
