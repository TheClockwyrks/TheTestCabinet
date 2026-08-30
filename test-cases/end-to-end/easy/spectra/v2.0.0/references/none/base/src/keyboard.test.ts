import { describe, expect, it } from "vitest";

import { ACTIONS, BINDINGS } from "./constants";
import { Keyboard, asKeyboardEvent } from "./keyboard";

/** A minimal event target, so the keyboard is driven with no DOM at all. */
class Target implements EventTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener | null): void {
    if (listener === null) return;
    const set = this.listeners.get(type) ?? new Set<EventListener>();
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

  down(code: string, repeat = false): void {
    this.dispatchEvent({ type: "keydown", code, repeat } as unknown as Event);
  }

  up(code: string): void {
    this.dispatchEvent({ type: "keyup", code } as unknown as Event);
  }
}

/** A keyboard with every one of Spectra's bindings registered. */
function bound(): { keys: Keyboard; target: Target } {
  const target = new Target();
  const keys = new Keyboard(target);
  for (const action of ACTIONS) keys.register(action, BINDINGS[action]);
  return { keys, target };
}

describe("the keyboard", () => {
  it("reads a bound key as held until it comes up", () => {
    const { keys, target } = bound();
    expect(keys.value("left")).toBe(0);
    target.down("ArrowLeft");
    expect(keys.value("left")).toBe(1);
    target.up("ArrowLeft");
    expect(keys.value("left")).toBe(0);
  });

  it("holds an action while either of its keys is still down", () => {
    const { keys, target } = bound();
    target.down("ArrowLeft");
    target.down("KeyA");
    target.up("ArrowLeft");
    expect(keys.value("left")).toBe(1);
    target.up("KeyA");
    expect(keys.value("left")).toBe(0);
  });

  it("arms one edge per press and consumes it on the first read", () => {
    const { keys, target } = bound();
    target.down("KeyF");
    expect(keys.pressed("b")).toBe(true);
    expect(keys.pressed("b")).toBe(false);
  });

  it("does not re-arm an edge for an operating-system auto-repeat", () => {
    const { keys, target } = bound();
    target.down("KeyF");
    expect(keys.pressed("b")).toBe(true);
    target.down("KeyF", true);
    expect(keys.pressed("b")).toBe(false);
    expect(keys.value("b")).toBe(1);
  });

  it("discards an edge nothing read at the end of the frame", () => {
    const { keys, target } = bound();
    target.down("KeyP");
    keys.endFrame();
    expect(keys.pressed("pause")).toBe(false);
  });

  it("drives every action a shared key is bound to", () => {
    const { keys, target } = bound();
    // Space drives both `a` and `confirm`; the screen decides which applies.
    target.down("Space");
    expect(keys.value("a")).toBe(1);
    expect(keys.pressed("confirm")).toBe(true);
    // Escape drives both `back` and `pause`.
    target.down("Escape");
    expect(keys.pressed("back")).toBe(true);
    expect(keys.pressed("pause")).toBe(true);
    // ArrowUp drives both `a` and `up`.
    target.down("ArrowUp");
    expect(keys.value("a")).toBe(1);
    expect(keys.pressed("up")).toBe(true);
  });

  it("reads an unregistered action as at rest rather than throwing", () => {
    const { keys } = bound();
    expect(keys.value("nonesuch")).toBe(0);
    expect(keys.pressed("nonesuch")).toBe(false);
  });

  it("returns an action to rest when it is rebound", () => {
    const { keys, target } = bound();
    target.down("KeyX");
    expect(keys.value("discharge")).toBe(1);
    keys.register("discharge", ["KeyZ"]);
    expect(keys.value("discharge")).toBe(0);
    target.down("KeyX");
    expect(keys.value("discharge")).toBe(0);
    target.down("KeyZ");
    expect(keys.value("discharge")).toBe(1);
  });

  it("drops its listeners on detach, idempotently", () => {
    const { keys, target } = bound();
    keys.detach();
    keys.detach();
    target.down("ArrowLeft");
    expect(keys.value("left")).toBe(0);
  });

  it("takes any event carrying a code, and nothing else", () => {
    expect(
      asKeyboardEvent({ code: "KeyM" } as unknown as Event),
    ).not.toBeNull();
    expect(asKeyboardEvent({} as unknown as Event)).toBeNull();
    const { keys, target } = bound();
    target.dispatchEvent({ type: "keydown" } as unknown as Event);
    expect(keys.value("left")).toBe(0);
  });
});
