import { describe, expect, it } from "vitest";

import { Keyboard, asKeyboardEvent } from "./keyboard";

/** A bare event target, standing in for the document. */
class Bus implements EventTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener | null): void {
    if (listener === null) return;
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: EventListener | null): void {
    if (listener === null) return;
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    for (const listener of this.listeners.get(event.type) ?? []) {
      listener(event);
    }
    return true;
  }

  /** A key event as a browser or an automation driver dispatches one. */
  key(type: "keydown" | "keyup", code: string, repeat = false): void {
    this.dispatchEvent({ type, code, repeat } as unknown as Event);
  }
}

describe("the keyboard", () => {
  it("reports an action as held between its down and its up", () => {
    const bus = new Bus();
    const keyboard = new Keyboard(bus);
    keyboard.register("thrust", ["ArrowUp", "KeyW"]);
    expect(keyboard.value("thrust")).toBe(0);
    bus.key("keydown", "KeyW");
    expect(keyboard.value("thrust")).toBe(1);
    bus.key("keyup", "KeyW");
    expect(keyboard.value("thrust")).toBe(0);
  });

  it("holds an action until the last of its keys comes up", () => {
    const bus = new Bus();
    const keyboard = new Keyboard(bus);
    keyboard.register("thrust", ["ArrowUp", "KeyW"]);
    bus.key("keydown", "KeyW");
    bus.key("keydown", "ArrowUp");
    bus.key("keyup", "KeyW");
    expect(keyboard.value("thrust")).toBe(1);
    bus.key("keyup", "ArrowUp");
    expect(keyboard.value("thrust")).toBe(0);
  });

  it("arms one edge per press and consumes it once", () => {
    const bus = new Bus();
    const keyboard = new Keyboard(bus);
    keyboard.register("fire", ["Space"]);
    bus.key("keydown", "Space");
    expect(keyboard.pressed("fire")).toBe(true);
    expect(keyboard.pressed("fire")).toBe(false);
  });

  it("discards an edge nothing consumed at the end of the frame", () => {
    const bus = new Bus();
    const keyboard = new Keyboard(bus);
    keyboard.register("fire", ["Space"]);
    bus.key("keydown", "Space");
    keyboard.endFrame();
    expect(keyboard.pressed("fire")).toBe(false);
  });

  it("treats an auto-repeat as no new press", () => {
    const bus = new Bus();
    const keyboard = new Keyboard(bus);
    keyboard.register("mute", ["KeyM"]);
    bus.key("keydown", "KeyM");
    expect(keyboard.pressed("mute")).toBe(true);
    bus.key("keydown", "KeyM", true);
    expect(keyboard.pressed("mute")).toBe(false);
  });

  it("gives one key to every action bound to it, each with its own edge", () => {
    const bus = new Bus();
    const keyboard = new Keyboard(bus);
    keyboard.register("fire", ["Space"]);
    keyboard.register("confirm", ["Space", "Enter"]);
    bus.key("keydown", "Space");
    expect(keyboard.pressed("fire")).toBe(true);
    // Reading one meaning of the key never eats the other's.
    expect(keyboard.pressed("confirm")).toBe(true);
  });

  it("reads an unregistered action as at rest rather than throwing", () => {
    const keyboard = new Keyboard(new Bus());
    expect(keyboard.value("nothing")).toBe(0);
    expect(keyboard.pressed("nothing")).toBe(false);
  });

  it("returns an action to rest when it is rebound", () => {
    const bus = new Bus();
    const keyboard = new Keyboard(bus);
    keyboard.register("left", ["KeyA"]);
    bus.key("keydown", "KeyA");
    keyboard.register("left", ["ArrowLeft"]);
    expect(keyboard.value("left")).toBe(0);
    bus.key("keydown", "KeyA");
    expect(keyboard.value("left")).toBe(0);
  });

  it("stops listening once detached, twice over", () => {
    const bus = new Bus();
    const keyboard = new Keyboard(bus);
    keyboard.register("fire", ["Space"]);
    keyboard.detach();
    keyboard.detach();
    bus.key("keydown", "Space");
    expect(keyboard.value("fire")).toBe(0);
  });

  it("narrows an event structurally, so a dispatched plain event still counts", () => {
    expect(
      asKeyboardEvent({ code: "KeyM" } as unknown as Event),
    ).not.toBeNull();
    expect(asKeyboardEvent({} as Event)).toBeNull();
  });
});
