// Fathom — the actions the game registers, and the layout it is written for.

import { describe, expect, it } from "vitest";
import type { InitApi } from "@test-cabinet/structured-2d";
import { ACTIONS, BINDINGS, LAYOUT } from "./constants";
import { MOVE_ACTIONS, registerActions } from "./input";

type Registration = { name: string; keys: readonly string[] };

function recorder(layout: string | null): {
  api: Pick<InitApi, "input">;
  registered: Registration[];
} {
  const registered: Registration[] = [];
  return {
    registered,
    api: {
      input: {
        register: (name, binding) =>
          registered.push({ name, keys: binding.keys }),
        layout: () => (layout === null ? null : { name: layout, actions: [] }),
      },
    },
  };
}

describe("the registered actions", () => {
  it("registers the layout's whole vocabulary, in order, with its keys", () => {
    const { api, registered } = recorder(LAYOUT);
    registerActions(api);
    expect(registered.map((entry) => entry.name)).toEqual([...ACTIONS]);
    for (const entry of registered) {
      expect(entry.keys).toEqual([
        ...BINDINGS[entry.name as (typeof ACTIONS)[number]],
      ]);
    }
    // The overlay's own key is left free of bindings.
    expect(registered.flatMap((entry) => entry.keys)).not.toContain(
      "Backquote",
    );
  });

  it("refuses an engine built without the layout it is written for", () => {
    expect(() => registerActions(recorder(null).api)).toThrow(LAYOUT);
    expect(() => registerActions(recorder("dpad-4").api)).toThrow("dpad-4");
  });

  it("steers on the four movement actions alone", () => {
    expect(MOVE_ACTIONS.map(([action]) => action)).toEqual([
      "up",
      "down",
      "left",
      "right",
    ]);
    expect(MOVE_ACTIONS.map(([, dir]) => dir)).toEqual([
      "up",
      "down",
      "left",
      "right",
    ]);
  });
});
