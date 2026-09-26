import { describe, expect, it } from "vitest";
import { BINDINGS } from "./constants";
import {
  Controls,
  MOUSE_PRIMARY,
  MOUSE_SECONDARY,
  asKeyboardEvent,
  type PointerMap,
} from "./input";

/** A tiny event target, so the layer is checked with no DOM behind it. */
class Bus implements EventTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
  ): void {
    if (typeof listener !== "function") return;
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
  ): void {
    if (typeof listener !== "function") return;
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    for (const listener of this.listeners.get(event.type) ?? [])
      listener(event);
    return true;
  }

  /** Whether anything is still listening for `type`. */
  has(type: string): boolean {
    return (this.listeners.get(type)?.size ?? 0) > 0;
  }
}

/** A key event as the page delivers it, and as a driver dispatches it. */
function key(type: string, code: string, repeat = false): Event {
  return { type, code, repeat } as unknown as Event;
}

function mouse(type: string, button: number, clientX = 0, clientY = 0): Event {
  return {
    type,
    button,
    clientX,
    clientY,
    preventDefault: () => undefined,
  } as unknown as Event;
}

function controls(map: PointerMap = (x: number, y: number) => ({ x, y })) {
  const keys = new Bus();
  const pointer = new Bus();
  const layer = new Controls(keys, pointer, map);
  for (const [action, codes] of Object.entries(BINDINGS)) {
    layer.register(action, codes);
  }
  layer.register("fire", [...BINDINGS.fire, MOUSE_PRIMARY]);
  layer.register("swap", [...BINDINGS.swap, MOUSE_SECONDARY]);
  return { layer, keys, pointer };
}

describe("actions", () => {
  it("reads a held action while any of its keys is down", () => {
    const { layer, keys } = controls();
    expect(layer.value("left")).toBe(0);
    keys.dispatchEvent(key("keydown", "ArrowLeft"));
    expect(layer.value("left")).toBe(1);
    keys.dispatchEvent(key("keyup", "ArrowLeft"));
    expect(layer.value("left")).toBe(0);
  });

  it("arms one edge per press, and consumes it on the first read", () => {
    const { layer, keys } = controls();
    keys.dispatchEvent(key("keydown", "Space"));
    expect(layer.pressed("fire")).toBe(true);
    expect(layer.pressed("fire")).toBe(false);
  });

  it("arms no edge for an auto-repeat", () => {
    const { layer, keys } = controls();
    keys.dispatchEvent(key("keydown", "KeyM"));
    expect(layer.pressed("mute")).toBe(true);
    keys.dispatchEvent(key("keydown", "KeyM", true));
    expect(layer.pressed("mute")).toBe(false);
  });

  it("drives two actions from one key, and one action from two keys", () => {
    const { layer, keys } = controls();
    keys.dispatchEvent(key("keydown", "Space"));
    expect(layer.pressed("fire")).toBe(true);
    expect(layer.pressed("confirm")).toBe(true);
    keys.dispatchEvent(key("keyup", "Space"));
    keys.dispatchEvent(key("keydown", "Enter"));
    expect(layer.pressed("confirm")).toBe(true);
  });

  it("discards an edge nothing consumed at the end of a frame", () => {
    const { layer, keys } = controls();
    keys.dispatchEvent(key("keydown", "Escape"));
    layer.endFrame();
    expect(layer.pressed("pause")).toBe(false);
  });

  it("reads an unregistered action as at rest", () => {
    const { layer } = controls();
    expect(layer.value("nonsense")).toBe(0);
    expect(layer.pressed("nonsense")).toBe(false);
  });

  it("returns a rebound action to rest", () => {
    const { layer, keys } = controls();
    keys.dispatchEvent(key("keydown", "ArrowRight"));
    expect(layer.value("right")).toBe(1);
    layer.register("right", ["KeyD"]);
    expect(layer.value("right")).toBe(0);
  });

  it("ignores an event carrying no key code", () => {
    const { layer, keys } = controls();
    keys.dispatchEvent({ type: "keydown" } as Event);
    expect(layer.pressed("fire")).toBe(false);
    expect(asKeyboardEvent({ type: "keydown" } as Event)).toBeNull();
  });
});

describe("the pointer", () => {
  it("delivers a position once, in the field's own units", () => {
    const { layer, pointer } = controls((x, y) => ({ x: x / 2, y: y / 2 }));
    pointer.dispatchEvent(mouse("pointermove", -1, 800, 600));
    expect(layer.pointer()).toEqual({ x: 400, y: 300 });
    expect(layer.pointer()).toBeNull();
  });

  it("delivers nothing while the fit is degenerate", () => {
    const { layer, pointer } = controls(() => null);
    pointer.dispatchEvent(mouse("pointermove", -1, 10, 10));
    expect(layer.pointer()).toBeNull();
  });

  it("raises fire on the primary button and swap on the secondary", () => {
    const { layer, pointer } = controls();
    pointer.dispatchEvent(mouse("pointerdown", 0, 100, 100));
    expect(layer.pressed("fire")).toBe(true);
    expect(layer.pointer()).toEqual({ x: 100, y: 100 });
    pointer.dispatchEvent(mouse("pointerup", 0));
    pointer.dispatchEvent(mouse("pointerdown", 2, 100, 100));
    expect(layer.pressed("swap")).toBe(true);
    pointer.dispatchEvent(mouse("pointerup", 2));
    expect(layer.value("swap")).toBe(0);
  });

  it("keeps the browser's context menu closed", () => {
    const { pointer } = controls();
    let prevented = false;
    pointer.dispatchEvent({
      type: "contextmenu",
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as Event);
    expect(prevented).toBe(true);
  });
});

describe("teardown", () => {
  it("drops every listener, once", () => {
    const { layer, keys, pointer } = controls();
    layer.detach();
    expect(keys.has("keydown")).toBe(false);
    expect(pointer.has("pointermove")).toBe(false);
    layer.detach();
  });
});
