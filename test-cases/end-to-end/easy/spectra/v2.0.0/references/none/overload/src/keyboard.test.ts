// Spectra — the keyboard, as named actions.

import { describe, expect, it } from "vitest";
import { BINDINGS } from "./constants";
import { Keyboard, asKeyboardEvent } from "./keyboard";

/** A key event as a driver dispatches one: a plain event carrying a `code`. */
function key(type: string, code: string, repeat = false): Event {
  const event = new Event(type) as Event & { code: string; repeat: boolean };
  event.code = code;
  event.repeat = repeat;
  return event;
}

function bus(): { target: EventTarget; keys: Keyboard } {
  const target = new EventTarget();
  return { target, keys: new Keyboard(target) };
}

describe("Keyboard", () => {
  it("holds an action while any of its keys is down", () => {
    const { target, keys } = bus();
    keys.register("left", BINDINGS.left);
    expect(keys.value("left")).toBe(0);
    target.dispatchEvent(key("keydown", "ArrowLeft"));
    target.dispatchEvent(key("keydown", "KeyA"));
    expect(keys.value("left")).toBe(1);
    target.dispatchEvent(key("keyup", "ArrowLeft"));
    expect(keys.value("left")).toBe(1);
    target.dispatchEvent(key("keyup", "KeyA"));
    expect(keys.value("left")).toBe(0);
  });

  it("arms one edge per press, consumed by the first reader", () => {
    const { target, keys } = bus();
    keys.register("b", BINDINGS.b);
    target.dispatchEvent(key("keydown", "KeyF"));
    expect(keys.pressed("b")).toBe(true);
    expect(keys.pressed("b")).toBe(false);
  });

  it("takes an OS auto-repeat for no new press", () => {
    const { target, keys } = bus();
    keys.register("b", BINDINGS.b);
    target.dispatchEvent(key("keydown", "KeyF"));
    keys.pressed("b");
    target.dispatchEvent(key("keydown", "KeyF", true));
    expect(keys.pressed("b")).toBe(false);
  });

  it("discards an edge nothing read at the end of the frame", () => {
    const { target, keys } = bus();
    keys.register("pause", BINDINGS.pause);
    target.dispatchEvent(key("keydown", "KeyP"));
    keys.endFrame();
    expect(keys.pressed("pause")).toBe(false);
  });

  it("drives every action one shared key is bound to", () => {
    const { target, keys } = bus();
    keys.register("back", BINDINGS.back);
    keys.register("pause", BINDINGS.pause);
    target.dispatchEvent(key("keydown", "Escape"));
    expect(keys.pressed("back")).toBe(true);
    expect(keys.pressed("pause")).toBe(true);
  });

  it("returns every action to rest when the window loses focus", () => {
    const { target, keys } = bus();
    keys.register("right", BINDINGS.right);
    target.dispatchEvent(key("keydown", "ArrowRight"));
    target.dispatchEvent(new Event("blur"));
    expect(keys.value("right")).toBe(0);
  });

  it("replaces a binding wholesale on a re-register", () => {
    const { target, keys } = bus();
    keys.register("left", ["ArrowLeft"]);
    target.dispatchEvent(key("keydown", "ArrowLeft"));
    keys.register("left", ["KeyA"]);
    expect(keys.value("left")).toBe(0);
    target.dispatchEvent(key("keydown", "ArrowLeft"));
    expect(keys.value("left")).toBe(0);
    target.dispatchEvent(key("keydown", "KeyA"));
    expect(keys.value("left")).toBe(1);
  });

  it("reads an unregistered action as at rest rather than throwing", () => {
    const { keys } = bus();
    expect(keys.value("nothing")).toBe(0);
    expect(keys.pressed("nothing")).toBe(false);
  });

  it("drops its listeners once, idempotently", () => {
    const { target, keys } = bus();
    keys.register("mute", BINDINGS.mute);
    keys.detach();
    keys.detach();
    target.dispatchEvent(key("keydown", "KeyM"));
    expect(keys.pressed("mute")).toBe(false);
  });

  it("narrows an event to a key event by its code alone", () => {
    expect(asKeyboardEvent(key("keydown", "KeyM"))).not.toBeNull();
    expect(asKeyboardEvent(new Event("keydown"))).toBeNull();
  });
});
