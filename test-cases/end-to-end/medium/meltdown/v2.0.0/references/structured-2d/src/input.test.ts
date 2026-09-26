// The actions the game registers, and the layout it is written against.

import { describe, expect, it } from "vitest";
import { ACTIONS, BINDINGS, LAYOUT } from "./constants";
import { registerActions } from "./input";

/** A stand-in for the slice of `InitApi` registration reads. */
function fakeApi(layoutName: string | null) {
  const registered: { action: string; keys: readonly string[] }[] = [];
  return {
    registered,
    api: {
      input: {
        register: (action: string, binding: { keys: string[] }) => {
          registered.push({ action, keys: binding.keys });
        },
        layout: () =>
          layoutName === null ? null : { name: layoutName, actions: [] },
      },
    },
  };
}

describe("the bindings", () => {
  it("binds every action, and no key drives two of them", () => {
    const seen = new Map<string, string>();
    for (const action of ACTIONS) {
      const keys = BINDINGS[action];
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(seen.has(key)).toBe(false);
        seen.set(key, action);
      }
    }
    // The overlay's own key is left free of bindings; the engine owns it.
    expect(seen.has("Backquote")).toBe(false);
  });
});

describe("registration", () => {
  it("registers every action against the keys it is bound to", () => {
    const { api, registered } = fakeApi(LAYOUT);
    registerActions(api as unknown as Parameters<typeof registerActions>[0]);
    expect(registered.map((entry) => entry.action)).toEqual([...ACTIONS]);
    for (const entry of registered) {
      expect(entry.keys).toEqual([
        ...BINDINGS[entry.action as (typeof ACTIONS)[number]],
      ]);
    }
  });

  it("fails loudly on an engine built without the layout it is written against", () => {
    const wrong = fakeApi("dpad-4-two-buttons");
    expect(() =>
      registerActions(
        wrong.api as unknown as Parameters<typeof registerActions>[0],
      ),
    ).toThrow(/dpad-4/);
    const none = fakeApi(null);
    expect(() =>
      registerActions(
        none.api as unknown as Parameters<typeof registerActions>[0],
      ),
    ).toThrow(/dpad-4/);
  });
});
