// Registering the actions: the layout the engine was built with and the
// vocabulary this build registers have to be the same list.

import { describe, expect, it } from "vitest";
import { ACTIONS, BINDINGS, LAYOUT } from "./constants";
import { registerActions } from "./input";
import type { ActionBinding, TouchLayout } from "@clockwyrks/simple-2d";

function api(layout: TouchLayout | null): {
  input: {
    register(name: string, binding: ActionBinding): void;
    layout(): TouchLayout | null;
  };
  registered: Map<string, ActionBinding>;
} {
  const registered = new Map<string, ActionBinding>();
  return {
    input: {
      register: (name, binding) => {
        registered.set(name, binding);
      },
      layout: () => layout,
    },
    registered,
  };
}

describe("registering", () => {
  it("binds every action to the keys the specification names", () => {
    const stub = api({ name: LAYOUT, actions: [...ACTIONS] });
    registerActions(stub);
    expect([...stub.registered.keys()]).toEqual([...ACTIONS]);
    for (const action of ACTIONS) {
      expect(stub.registered.get(action)?.keys).toEqual([...BINDINGS[action]]);
    }
  });

  it("fails loudly when the engine carries no layout", () => {
    expect(() => registerActions(api(null))).toThrow(LAYOUT);
  });

  it("fails loudly when the layout speaks a different vocabulary", () => {
    const stub = api({ name: "dpad-4", actions: ["up", "down"] });
    expect(() => registerActions(stub)).toThrow("dpad-4");
  });
});
