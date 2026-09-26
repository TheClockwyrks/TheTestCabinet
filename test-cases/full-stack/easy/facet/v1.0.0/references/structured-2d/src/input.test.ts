// Registering the actions the engine listens for.

import { describe, expect, it, vi } from "vitest";
import type { InitApi } from "@clockwyrks/structured-2d";
import { registerActions } from "./input";
import { ACTIONS, BINDINGS, LAYOUT } from "./constants";

function api(layout: { name: string; actions: string[] } | null): {
  input: InitApi["input"];
  register: ReturnType<typeof vi.fn>;
} {
  const register = vi.fn();
  return { input: { register, layout: () => layout }, register };
}

describe("registerActions", () => {
  it("registers every action against its physical keys", () => {
    const harness = api({ name: LAYOUT, actions: [...ACTIONS] });
    registerActions(harness);
    expect(harness.register).toHaveBeenCalledTimes(ACTIONS.length);
    for (const action of ACTIONS) {
      expect(harness.register).toHaveBeenCalledWith(action, {
        keys: [...BINDINGS[action]],
      });
    }
  });

  it("binds the keys specs/controls.md fixes", () => {
    expect(BINDINGS.up).toEqual(["ArrowUp"]);
    expect(BINDINGS.down).toEqual(["ArrowDown"]);
    expect(BINDINGS.confirm).toEqual(["Enter", "Space"]);
    expect(BINDINGS.pause).toEqual(["Escape", "KeyP"]);
    expect(BINDINGS.mute).toEqual(["KeyM"]);
    expect(BINDINGS.back).toEqual(["Escape"]);
  });

  it("registers the layout's own vocabulary and nothing else", () => {
    expect(LAYOUT).toBe("single-vertical");
    expect([...ACTIONS]).toEqual([
      "up",
      "down",
      "confirm",
      "back",
      "pause",
      "mute",
    ]);
  });

  it("leaves the overlay's own key free of bindings", () => {
    for (const keys of Object.values(BINDINGS)) {
      expect(keys).not.toContain("Backquote");
    }
  });

  it("refuses an engine built without the layout it is written against", () => {
    expect(() => registerActions(api(null))).toThrow(/single-vertical layout/);
    expect(() => registerActions(api({ name: "dpad-4", actions: [] }))).toThrow(
      /not dpad-4/,
    );
  });
});
