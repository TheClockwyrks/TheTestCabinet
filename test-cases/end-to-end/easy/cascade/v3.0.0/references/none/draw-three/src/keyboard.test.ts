// The one key this game answers, and how the runtime reads it.

import { describe, expect, it, vi } from "vitest";
import { asKeyboardEvent, KeyWatcher } from "./keyboard";
import { OVERLAY_KEY } from "./overlay";

class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(code: string, repeat = false) {
    super("keydown");
    this.code = code;
    this.repeat = repeat;
  }
}

describe("asKeyboardEvent", () => {
  it("reads an event carrying a code", () => {
    expect(asKeyboardEvent(new KeyEvent("KeyA"))?.code).toBe("KeyA");
  });

  it("drops an event with no code", () => {
    expect(asKeyboardEvent(new Event("keydown"))).toBeNull();
  });

  it("drops an auto-repeat", () => {
    expect(asKeyboardEvent(new KeyEvent(OVERLAY_KEY, true))).toBeNull();
  });
});

describe("KeyWatcher", () => {
  it("answers only the codes it watches", () => {
    const watcher = new KeyWatcher();
    const seen = vi.fn();
    watcher.on(OVERLAY_KEY, seen);
    expect(watcher.size).toBe(1);
    expect(watcher.handle(new KeyEvent("KeyA"))).toBe(false);
    expect(watcher.handle(new KeyEvent(OVERLAY_KEY))).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("replaces a handler rather than adding a second", () => {
    const watcher = new KeyWatcher();
    const first = vi.fn();
    const second = vi.fn();
    watcher.on(OVERLAY_KEY, first);
    watcher.on(OVERLAY_KEY, second);
    watcher.handle(new KeyEvent(OVERLAY_KEY));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("keeps a throwing handler out of the page's event dispatch", () => {
    const watcher = new KeyWatcher();
    watcher.on(OVERLAY_KEY, () => {
      throw new Error("broken panel");
    });
    expect(() => watcher.handle(new KeyEvent(OVERLAY_KEY))).not.toThrow();
  });
});
