import { describe, expect, it } from "vitest";
import { KeyWatcher, asKeyboardEvent } from "./keyboard";

class Target implements EventTarget {
  private readonly listeners = new Set<EventListener>();

  addEventListener(_type: string, listener: EventListener | null): void {
    if (listener !== null) this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: EventListener | null): void {
    if (listener !== null) this.listeners.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    for (const listener of [...this.listeners]) listener(event);
    return true;
  }

  press(code: string, repeat = false): void {
    this.dispatchEvent(Object.assign(new Event("keydown"), { code, repeat }));
  }
}

describe("the key watcher", () => {
  it("calls back on the code it watches, and on no other", () => {
    const target = new Target();
    let calls = 0;
    new KeyWatcher(target, "Backquote", () => {
      calls += 1;
    });
    target.press("KeyA");
    expect(calls).toBe(0);
    target.press("Backquote");
    expect(calls).toBe(1);
  });

  it("ignores an auto-repeat, which is not a new press", () => {
    const target = new Target();
    let calls = 0;
    new KeyWatcher(target, "Backquote", () => {
      calls += 1;
    });
    target.press("Backquote", true);
    expect(calls).toBe(0);
  });

  it("drops its listener once, however often it is detached", () => {
    const target = new Target();
    let calls = 0;
    const watcher = new KeyWatcher(target, "Backquote", () => {
      calls += 1;
    });
    watcher.detach();
    watcher.detach();
    target.press("Backquote");
    expect(calls).toBe(0);
  });

  it("narrows only an event carrying a code", () => {
    expect(asKeyboardEvent(new Event("keydown"))).toBeNull();
    expect(
      asKeyboardEvent(Object.assign(new Event("keydown"), { code: "KeyQ" }))
        ?.code,
    ).toBe("KeyQ");
  });
});
