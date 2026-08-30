// Wireworm — named actions over physical keys (specs/controls.md).
//
// Two questions and one rule: an action is HELD while any of its codes is down,
// an EDGE is armed when it leaves rest, and an edge is consumed by the first
// reader and discarded at the end of its frame.

import { describe, expect, test } from "vitest";
import { BINDINGS } from "./constants";
import { Keyboard, asKeyboardEvent } from "./keyboard";
import { keyEvent } from "./harness.test-support";

function armed(): { keys: EventTarget; keyboard: Keyboard } {
  const keys = new EventTarget();
  const keyboard = new Keyboard(keys);
  for (const [action, codes] of Object.entries(BINDINGS)) {
    keyboard.register(action, codes);
  }
  return { keys, keyboard };
}

describe("the keyboard", () => {
  test("an action is held while one of its codes is down", () => {
    const { keys, keyboard } = armed();
    expect(keyboard.value("left")).toBe(0);
    keys.dispatchEvent(keyEvent("keydown", "ArrowLeft"));
    expect(keyboard.value("left")).toBe(1);
    keys.dispatchEvent(keyEvent("keyup", "ArrowLeft"));
    expect(keyboard.value("left")).toBe(0);
  });

  test("either bound code drives the same action", () => {
    const { keys, keyboard } = armed();
    keys.dispatchEvent(keyEvent("keydown", "KeyA"));
    expect(keyboard.value("left")).toBe(1);
    keys.dispatchEvent(keyEvent("keyup", "KeyA"));
    expect(keyboard.value("left")).toBe(0);
  });

  test("one code drives every action it is bound to", () => {
    const { keys, keyboard } = armed();
    keys.dispatchEvent(keyEvent("keydown", "Escape"));
    expect(keyboard.pressed("back")).toBe(true);
    expect(keyboard.pressed("pause")).toBe(true);
  });

  test("an action stays held until the last of its codes comes up", () => {
    const { keys, keyboard } = armed();
    keys.dispatchEvent(keyEvent("keydown", "ArrowLeft"));
    keys.dispatchEvent(keyEvent("keydown", "KeyA"));
    keys.dispatchEvent(keyEvent("keyup", "ArrowLeft"));
    expect(keyboard.value("left")).toBe(1);
    keys.dispatchEvent(keyEvent("keyup", "KeyA"));
    expect(keyboard.value("left")).toBe(0);
  });

  test("an edge is consumed once and discarded at the end of its frame", () => {
    const { keys, keyboard } = armed();
    keys.dispatchEvent(keyEvent("keydown", "Enter"));
    expect(keyboard.pressed("confirm")).toBe(true);
    expect(keyboard.pressed("confirm")).toBe(false);

    keys.dispatchEvent(keyEvent("keyup", "Enter"));
    keys.dispatchEvent(keyEvent("keydown", "Enter"));
    keyboard.endFrame();
    expect(keyboard.pressed("confirm")).toBe(false);
  });

  test("an auto-repeat is not a new press", () => {
    const { keys, keyboard } = armed();
    const repeat = new Event("keydown");
    Object.assign(repeat, { code: "Enter", repeat: true });
    keys.dispatchEvent(repeat);
    expect(keyboard.pressed("confirm")).toBe(false);
    expect(keyboard.value("confirm")).toBe(0);
  });

  test("losing focus returns every action to rest", () => {
    const { keys, keyboard } = armed();
    keys.dispatchEvent(keyEvent("keydown", "ArrowRight"));
    expect(keyboard.value("right")).toBe(1);
    keys.dispatchEvent(new Event("blur"));
    expect(keyboard.value("right")).toBe(0);
  });

  test("an unregistered action reads as at rest", () => {
    const { keyboard } = armed();
    expect(keyboard.value("nothing")).toBe(0);
    expect(keyboard.pressed("nothing")).toBe(false);
  });

  test("a rebind replaces the binding and returns the action to rest", () => {
    const { keys, keyboard } = armed();
    keys.dispatchEvent(keyEvent("keydown", "ArrowUp"));
    expect(keyboard.value("up")).toBe(1);
    keyboard.register("up", ["KeyI"]);
    expect(keyboard.value("up")).toBe(0);
    keys.dispatchEvent(keyEvent("keydown", "ArrowUp"));
    expect(keyboard.value("up")).toBe(0);
    keys.dispatchEvent(keyEvent("keydown", "KeyI"));
    expect(keyboard.value("up")).toBe(1);
  });

  test("detaching is idempotent and stops the listening", () => {
    const { keys, keyboard } = armed();
    keyboard.detach();
    keyboard.detach();
    keys.dispatchEvent(keyEvent("keydown", "ArrowUp"));
    expect(keyboard.value("up")).toBe(0);
  });

  test("an event with no code reaches nothing", () => {
    expect(asKeyboardEvent(new Event("keydown"))).toBeNull();
    const { keys, keyboard } = armed();
    keys.dispatchEvent(new Event("keydown"));
    keys.dispatchEvent(new Event("keyup"));
    expect(keyboard.value("up")).toBe(0);
  });
});
