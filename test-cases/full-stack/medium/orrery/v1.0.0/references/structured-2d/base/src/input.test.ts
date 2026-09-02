import { describe, expect, it } from "vitest";
import type { InputReader, PointerSample } from "@test-cabinet/structured-2d";

import { ACTIONS, BINDINGS, type ActionName } from "./constants";
import { pointerSamples, pressedActions, registerActions } from "./input";

/** An input seam recording every registration. */
function registry(): {
  api: Parameters<typeof registerActions>[0];
  bound: Map<string, string[]>;
} {
  const bound = new Map<string, string[]>();
  return {
    bound,
    api: {
      input: {
        register: (name, binding) => bound.set(name, [...binding.keys]),
        layout: () => null,
      },
    },
  };
}

/** A reader whose edges are armed once, exactly as the engine's are. */
function reader(
  armed: readonly ActionName[],
  samples: readonly PointerSample[] = [],
): InputReader {
  const left = new Set<ActionName>(armed);
  return {
    value: () => 0,
    pressed: (name) => left.delete(name as ActionName),
    pointer: () => ({
      x: 0,
      y: 0,
      down: false,
      device: "mouse",
      buttons: [],
    }),
    pointerPressed: () => false,
    pointerReleased: () => false,
    pointerSamples: () => [...samples],
    pointerContacts: () => [],
    wheel: () => ({ x: 0, y: 0 }),
  };
}

/** One engine pointer sample, in the stage's logical units. */
function sample(
  type: PointerSample["type"],
  x: number,
  y: number,
  primary = true,
): PointerSample {
  return {
    type,
    x,
    y,
    id: primary ? 1 : 2,
    primary,
    device: "mouse",
    button: type === "move" ? null : "primary",
    buttons: type === "up" ? [] : ["primary"],
  };
}

describe("the action registry (specs/controls.md)", () => {
  it("registers every action against its bound keys, and nothing else", () => {
    const wired = registry();
    registerActions(wired.api);
    expect([...wired.bound.keys()]).toEqual([...ACTIONS]);
    for (const action of ACTIONS) {
      expect(wired.bound.get(action), action).toEqual([...BINDINGS[action]]);
    }
    // The overlay's toggle is engine chrome rather than a game action.
    for (const keys of wired.bound.values()) {
      expect(keys).not.toContain("Backquote");
    }
  });

  it("reads each armed edge once, in ACTIONS order", () => {
    const input = reader(["confirm", "up", "mute"]);
    expect(pressedActions(input)).toEqual(["up", "confirm", "mute"]);
    // The reader's edges are consumed on the read, so a second call is empty.
    expect(pressedActions(input)).toEqual([]);
  });
});

describe("the pointer (specs/controls.md)", () => {
  it("narrows every sample of the frame, in arrival order", () => {
    const input = reader(
      [],
      [sample("down", 10, 20), sample("move", 30, 40), sample("up", 50, 60)],
    );
    expect(pointerSamples(input)).toEqual([
      { type: "down", x: 10, y: 20 },
      { type: "move", x: 30, y: 40 },
      { type: "up", x: 50, y: 60 },
    ]);
  });

  it("follows the primary pointer alone, which is the one the state reports", () => {
    const input = reader(
      [],
      [sample("down", 10, 20), sample("down", 90, 90, false)],
    );
    expect(pointerSamples(input)).toEqual([{ type: "down", x: 10, y: 20 }]);
  });
});
