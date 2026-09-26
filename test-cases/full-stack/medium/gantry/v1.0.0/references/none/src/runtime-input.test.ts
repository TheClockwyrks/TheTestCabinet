// The keyboard and pointer tracker: the bindings `specs/controls.md` fixes,
// held state, press edges, and the pointer's acts in logical stage units.

import { describe, expect, it } from "vitest";
import { ACTIONS, BINDINGS, type ActionName } from "./constants";
import { actionsForCode, InputTracker, isBoundCode } from "./runtime-input";

describe("the bindings", () => {
  it("fires every action `specs/controls.md` binds, and nothing else", () => {
    for (const action of ACTIONS) {
      for (const code of BINDINGS[action]) {
        expect(actionsForCode(code)).toContain(action);
        expect(isBoundCode(code)).toBe(true);
      }
    }
    expect(actionsForCode("Backquote")).toEqual([]);
    expect(isBoundCode("Backquote")).toBe(false);
    expect(isBoundCode("KeyQ")).toBe(false);
  });

  it("binds the keys the table names", () => {
    expect(actionsForCode("ArrowUp")).toEqual(["up"]);
    expect(actionsForCode("Equal")).toEqual(["zoom-in"]);
    expect(actionsForCode("Minus")).toEqual(["zoom-out"]);
    expect(actionsForCode("Enter")).toEqual(["confirm"]);
    expect(actionsForCode("Escape")).toEqual(["back"]);
    expect(actionsForCode("Digit1")).toEqual(["tool-strut"]);
    expect(actionsForCode("Digit6")).toEqual(["tool-delete"]);
    expect(actionsForCode("KeyZ")).toEqual(["undo"]);
    expect(actionsForCode("KeyC")).toEqual(["check"]);
    expect(actionsForCode("KeyP")).toEqual(["program"]);
    expect(actionsForCode("KeyB")).toEqual(["build"]);
    expect(actionsForCode("KeyG")).toEqual(["run"]);
    expect(actionsForCode("KeyS")).toEqual(["speed"]);
    expect(actionsForCode("KeyM")).toEqual(["mute"]);
  });
});

describe("key presses", () => {
  it("delivers one press edge per key down", () => {
    const input = new InputTracker();
    input.keyDown("KeyG");
    expect(input.take().actions).toEqual(["run"]);
    expect(input.take().actions).toEqual([]);
  });

  it("gathers the presses of a frame in the order they arrived", () => {
    const input = new InputTracker();
    input.keyDown("ArrowDown");
    input.keyDown("Enter");
    input.keyDown("Escape");
    expect(input.take().actions).toEqual(["down", "confirm", "back"]);
  });

  it("holds an action while its key is down and releases it on the up", () => {
    const input = new InputTracker();
    expect(input.held("right")).toBe(false);
    input.keyDown("ArrowRight");
    expect(input.held("right")).toBe(true);
    input.take();
    // Taking the frame's edges leaves the key held.
    expect(input.held("right")).toBe(true);
    input.keyUp("ArrowRight");
    expect(input.held("right")).toBe(false);
  });

  it("holds one action apart from another", () => {
    const input = new InputTracker();
    input.keyDown("ArrowUp");
    input.keyDown("Equal");
    expect(input.held("up")).toBe(true);
    expect(input.held("zoom-in")).toBe(true);
    expect(input.held("down")).toBe(false);
    input.keyUp("ArrowUp");
    expect(input.held("up")).toBe(false);
    expect(input.held("zoom-in")).toBe(true);
  });

  it("ignores a key bound to nothing", () => {
    const input = new InputTracker();
    input.keyDown("KeyQ");
    expect(input.take().actions).toEqual([]);
    for (const action of ACTIONS) expect(input.held(action)).toBe(false);
  });

  it("takes a release of a key that was never down", () => {
    const input = new InputTracker();
    input.keyUp("KeyG");
    expect(input.take().actions).toEqual([]);
    expect(input.held("run")).toBe(false);
  });

  it("delivers a press for every action a key is bound to", () => {
    // Gantry binds one key to one action, so this is a property of the index
    // rather than of today's table.
    const seen = new Map<string, ActionName[]>();
    for (const action of ACTIONS) {
      for (const code of BINDINGS[action]) {
        seen.set(code, [...(seen.get(code) ?? []), action]);
      }
    }
    for (const [code, actions] of seen) {
      expect([...actionsForCode(code)]).toEqual(actions);
    }
  });
});

describe("the pointer", () => {
  it("reports the position a move puts it at", () => {
    const input = new InputTracker();
    expect(input.pointerX()).toBe(0);
    expect(input.pointerY()).toBe(0);
    input.pointerMove(640, 360);
    expect(input.pointerX()).toBe(640);
    expect(input.pointerY()).toBe(360);
  });

  it("gathers the acts of a frame in order", () => {
    const input = new InputTracker();
    input.pointerDown(10, 20);
    input.pointerMove(30, 40);
    input.pointerUp();
    expect(input.take().pointer).toEqual([
      { kind: "down", x: 10, y: 20 },
      { kind: "move", x: 30, y: 40 },
      { kind: "up", x: 30, y: 40 },
    ]);
  });

  it("moves the pointer to a press, so a press needs no move before it", () => {
    const input = new InputTracker();
    input.pointerDown(100, 200);
    expect(input.pointerX()).toBe(100);
    expect(input.pointerY()).toBe(200);
  });

  it("releases at the position the pointer is at", () => {
    const input = new InputTracker();
    input.pointerMove(7, 9);
    input.pointerUp();
    const acts = input.take().pointer;
    expect(acts[acts.length - 1]).toEqual({ kind: "up", x: 7, y: 9 });
  });

  it("knows whether a press is live", () => {
    const input = new InputTracker();
    expect(input.pointerDownNow()).toBe(false);
    input.pointerDown(1, 2);
    expect(input.pointerDownNow()).toBe(true);
    input.pointerMove(3, 4);
    expect(input.pointerDownNow()).toBe(true);
    input.pointerUp();
    expect(input.pointerDownNow()).toBe(false);
  });

  it("empties what a frame takes", () => {
    const input = new InputTracker();
    input.pointerMove(1, 1);
    expect(input.take().pointer).toHaveLength(1);
    expect(input.take().pointer).toEqual([]);
    // The position survives the take; only the acts are consumed.
    expect(input.pointerX()).toBe(1);
  });

  it("hands out a fresh array each frame", () => {
    const input = new InputTracker();
    input.pointerMove(1, 1);
    const first = input.take();
    input.pointerMove(2, 2);
    const second = input.take();
    expect(first.pointer).toHaveLength(1);
    expect(second.pointer).toHaveLength(1);
    expect(first.pointer).not.toBe(second.pointer);
  });
});
