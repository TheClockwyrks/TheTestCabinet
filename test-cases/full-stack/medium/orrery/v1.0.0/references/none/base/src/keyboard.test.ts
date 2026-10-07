import { describe, expect, it } from "vitest";

import { OVERLAY_TOGGLE_CODE } from "./constants";
import { Keyboard, asKeyboardEvent } from "./keyboard";

function key(type: string, code: string, repeat = false): Event {
  return Object.assign(new Event(type), { code, repeat });
}

describe("the keyboard beneath the actions (specs/controls.md)", () => {
  it("arms a press edge, and consumes it once", () => {
    const target = new EventTarget();
    const keyboard = new Keyboard(target);
    target.dispatchEvent(key("keydown", "ArrowUp"));
    expect(keyboard.pressed("up")).toBe(true);
    expect(keyboard.pressed("up")).toBe(false);
    keyboard.detach();
  });

  it("arms nothing for an auto-repeat, because the key never came up", () => {
    const target = new EventTarget();
    const keyboard = new Keyboard(target);
    target.dispatchEvent(key("keydown", "Enter"));
    expect(keyboard.pressed("confirm")).toBe(true);
    target.dispatchEvent(key("keydown", "Enter", true));
    expect(keyboard.pressed("confirm")).toBe(false);
    keyboard.detach();
  });

  it("arms again only after the key comes up", () => {
    const target = new EventTarget();
    const keyboard = new Keyboard(target);
    target.dispatchEvent(key("keydown", "Escape"));
    keyboard.endFrame();
    target.dispatchEvent(key("keydown", "Escape"));
    expect(keyboard.pressed("back")).toBe(false);
    target.dispatchEvent(key("keyup", "Escape"));
    target.dispatchEvent(key("keydown", "Escape"));
    expect(keyboard.pressed("back")).toBe(true);
    keyboard.detach();
  });

  it("fires both actions a shared key carries, so focus can pick one", () => {
    const target = new EventTarget();
    const keyboard = new Keyboard(target);
    target.dispatchEvent(key("keydown", "KeyW"));
    expect(keyboard.armed()).toEqual(["part-grow", "ins-extend"]);
    target.dispatchEvent(key("keyup", "KeyW"));
    target.dispatchEvent(key("keydown", "KeyS"));
    keyboard.endFrame();
    target.dispatchEvent(key("keyup", "KeyS"));
    expect(keyboard.armed()).toEqual([]);
    keyboard.detach();
  });

  it("holds a key while it is down, and lets it go on blur", () => {
    const target = new EventTarget();
    const keyboard = new Keyboard(target);
    target.dispatchEvent(key("keydown", "Space"));
    expect(keyboard.held("play")).toBe(true);
    target.dispatchEvent(new Event("blur"));
    expect(keyboard.held("play")).toBe(false);
    keyboard.detach();
  });

  it("discards every edge nothing read at the end of the frame", () => {
    const target = new EventTarget();
    const keyboard = new Keyboard(target);
    target.dispatchEvent(key("keydown", "KeyM"));
    keyboard.endFrame();
    expect(keyboard.pressed("mute")).toBe(false);
    keyboard.detach();
  });

  it("counts the overlay key apart from every action", () => {
    const target = new EventTarget();
    const keyboard = new Keyboard(target);
    target.dispatchEvent(key("keydown", OVERLAY_TOGGLE_CODE));
    target.dispatchEvent(key("keydown", OVERLAY_TOGGLE_CODE, true));
    expect(keyboard.drainOverlayToggles()).toBe(1);
    expect(keyboard.drainOverlayToggles()).toBe(0);
    expect(keyboard.armed()).toEqual([]);
    keyboard.detach();
  });

  it("runs the first-press handler once, for the audio unlock", () => {
    const target = new EventTarget();
    const keyboard = new Keyboard(target);
    let presses = 0;
    keyboard.onFirstPress(() => {
      presses += 1;
    });
    target.dispatchEvent(key("keydown", "KeyM"));
    target.dispatchEvent(key("keydown", "KeyN"));
    expect(presses).toBe(1);
    keyboard.detach();
  });

  it("stops listening once detached, twice over", () => {
    const target = new EventTarget();
    const keyboard = new Keyboard(target);
    keyboard.detach();
    keyboard.detach();
    target.dispatchEvent(key("keydown", "ArrowDown"));
    expect(keyboard.pressed("down")).toBe(false);
  });

  it("reads a keyboard event structurally, whatever realm it came from", () => {
    expect(asKeyboardEvent(key("keydown", "KeyQ"))?.code).toBe("KeyQ");
    expect(asKeyboardEvent(new Event("keydown"))).toBeNull();
  });
});
