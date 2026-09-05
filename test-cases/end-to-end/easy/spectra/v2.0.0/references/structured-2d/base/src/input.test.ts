// The actions the build registers, and the layout it insists on.

import { describe, expect, it } from "vitest";
import { ACTIONS, BINDINGS, LAYOUT } from "./constants";
import { IDLE_INPUT, readInput, registerActions } from "./input";
import type {
  InitApi,
  InputReader,
  TouchLayout,
} from "@clockwyrks/structured-2d";

/** An `InitApi.input` that records what was registered against it. */
function recorder(layout: TouchLayout | null): {
  api: Pick<InitApi, "input">;
  registered: Map<string, readonly string[]>;
} {
  const registered = new Map<string, readonly string[]>();
  return {
    api: {
      input: {
        register: (name: string, binding: { keys: string[] }) => {
          registered.set(name, binding.keys);
        },
        layout: () => layout,
      },
    },
    registered,
  };
}

describe("registering the actions", () => {
  it("registers every action against the keys the specification gives it", () => {
    const { api, registered } = recorder({
      name: LAYOUT,
      actions: ["up", "down", "left", "right", "a", "b"],
    });
    registerActions(api);
    expect([...registered.keys()]).toEqual([...ACTIONS]);
    for (const action of ACTIONS) {
      expect(registered.get(action)).toEqual([...BINDINGS[action]]);
    }
  });

  it("registers Spectra's own discharge beyond the layout's vocabulary", () => {
    const { api, registered } = recorder({ name: LAYOUT, actions: ["a", "b"] });
    registerActions(api);
    expect(registered.get("discharge")).toEqual(["KeyX"]);
  });

  it("leaves the overlay's own key unbound", () => {
    for (const keys of Object.values(BINDINGS)) {
      expect(keys).not.toContain("Backquote");
    }
  });

  it("refuses an engine built without a layout", () => {
    const { api } = recorder(null);
    expect(() => registerActions(api)).toThrow(LAYOUT);
  });

  it("refuses a layout speaking an action this build does not register", () => {
    const { api } = recorder({ name: LAYOUT, actions: ["p1-up"] });
    expect(() => registerActions(api)).toThrow("p1-up");
  });
});

describe("reading a frame", () => {
  it("reads the holds through value and the edges through pressed", () => {
    const asked: string[] = [];
    const reader = {
      value: (name: string) => {
        asked.push(`value:${name}`);
        return name === "right" ? 1 : 0;
      },
      pressed: (name: string) => {
        asked.push(`pressed:${name}`);
        return name === "b";
      },
      pointerSamples: () => [],
    } as unknown as InputReader;

    const input = readInput(reader);
    expect(input.mx).toBe(1);
    expect(input.flip).toBe(true);
    expect(input.fire).toBe(false);
    expect(asked).toContain("value:left");
    expect(asked).toContain("value:a");
    // Every edge is read, whichever screen is showing, so none survives.
    for (const action of [
      "up",
      "down",
      "b",
      "discharge",
      "confirm",
      "back",
      "pause",
      "mute",
    ]) {
      expect(asked).toContain(`pressed:${action}`);
    }
  });

  it("cancels a pair of directions held at once", () => {
    const reader = {
      value: () => 1,
      pressed: () => false,
      pointerSamples: () => [],
    } as unknown as InputReader;
    expect(readInput(reader).mx).toBe(0);
  });

  it("has an idle frame in which the player did nothing", () => {
    const { pointer, ...actions } = IDLE_INPUT;
    expect(Object.values(actions).every((value) => !value)).toBe(true);
    // The pointer is a list rather than a flag, and an idle frame carries none.
    expect(pointer).toEqual([]);
  });
});
