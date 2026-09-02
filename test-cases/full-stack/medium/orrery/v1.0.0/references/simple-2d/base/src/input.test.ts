// The three things Orrery reads from the engine's input (specs/controls.md).
//
// The listening, the edge detection, and the mapping into stage units are the
// engine's, so what is checked here is Orrery's half: that every action in
// `ACTIONS` is registered under its `BINDINGS`, that a frame's press edges
// come back in the order the specification lists them, and that the pointer's
// samples arrive in ARRIVAL ORDER, reduced to the three facts the editor
// reads, with a second pointer's samples left out.

import type {
  InitApi,
  PointerSample as EnginePointerSample,
  TouchLayout,
} from "@test-cabinet/simple-2d";
import { describe, expect, it } from "vitest";

import { ACTIONS, BINDINGS } from "./constants";
import { pointerSamples, pressedActions, registerActions } from "./input";

/** An input api that records every registration it was given. */
function registry(): {
  registered: Map<string, readonly string[]>;
  api: Pick<InitApi, "input">;
} {
  const registered = new Map<string, readonly string[]>();
  return {
    registered,
    api: {
      input: {
        register: (name, binding) => registered.set(name, binding.keys),
        layout: (): TouchLayout | null => null,
      },
    },
  };
}

/** An update-time input api answering a fixed set of pressed actions. */
function frameInput(
  pressed: readonly string[],
  samples: readonly Partial<EnginePointerSample>[] = [],
) {
  const consumed = new Set<string>();
  return {
    consumed,
    api: {
      input: {
        value: () => 0,
        pressed: (name: string) => {
          if (!pressed.includes(name) || consumed.has(name)) return false;
          consumed.add(name);
          return true;
        },
        pointer: () => ({
          x: 0,
          y: 0,
          down: false,
          device: "mouse" as const,
          buttons: [],
        }),
        pointerPressed: () => false,
        pointerReleased: () => false,
        pointerSamples: () => samples as EnginePointerSample[],
        pointerContacts: () => [],
        wheel: () => ({ x: 0, y: 0 }),
      },
    },
  };
}

describe("registering the actions (specs/controls.md)", () => {
  it("registers every action under exactly its bindings", () => {
    const { api, registered } = registry();
    registerActions(api);
    expect([...registered.keys()].sort()).toEqual([...ACTIONS].sort());
    for (const action of ACTIONS) {
      expect(registered.get(action), action).toEqual([...BINDINGS[action]]);
    }
  });

  it("registers no action for the overlay's key", () => {
    const { api, registered } = registry();
    registerActions(api);
    for (const keys of registered.values()) {
      expect(keys).not.toContain("Backquote");
    }
  });
});

describe("reading a frame's press edges (specs/controls.md)", () => {
  it("returns them in the order `ACTIONS` declares, consuming each once", () => {
    const { api } = frameInput(["confirm", "up", "mute"]);
    expect(pressedActions(api)).toEqual(["up", "confirm", "mute"]);
    // The engine consumes an edge at the first read, so a second read is empty.
    expect(pressedActions(api)).toEqual([]);
  });
});

describe("reading a frame's pointer samples (specs/controls.md)", () => {
  it("keeps every sample, in arrival order, reduced to what the editor reads", () => {
    const { api } = frameInput(
      [],
      [
        { type: "down", x: 1, y: 2, primary: true },
        { type: "move", x: 3, y: 4, primary: true },
        { type: "up", x: 5, y: 6, primary: true },
      ],
    );
    expect(pointerSamples(api)).toEqual([
      { type: "down", x: 1, y: 2 },
      { type: "move", x: 3, y: 4 },
      { type: "up", x: 5, y: 6 },
    ]);
  });

  it("leaves a second pointer's samples out: the editor is worked by one", () => {
    const { api } = frameInput(
      [],
      [
        { type: "down", x: 1, y: 2, primary: true },
        { type: "down", x: 9, y: 9, primary: false },
      ],
    );
    expect(pointerSamples(api)).toEqual([{ type: "down", x: 1, y: 2 }]);
  });
});
