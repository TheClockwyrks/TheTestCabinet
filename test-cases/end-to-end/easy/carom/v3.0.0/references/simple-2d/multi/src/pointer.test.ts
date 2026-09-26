// The pointer and touch rules specs/ui.md fixes, checked one frame at a time
// against `readPointerMenu`. Everything here is a pure call over a state and a
// list of samples: no engine, no canvas, no clock.
//
// The rule with the memory in it is the confirm: BOTH edges have to fall inside
// ONE item's region, and they may arrive on different frames — so a press is
// carried in the state until its release arrives, and the checks below drive two
// frames wherever that matters.

import { describe, expect, it } from "vitest";
import { createInitialState } from "./flow";
import { menuItemRect } from "./menu";
import { readPointerMenu } from "./pointer";
import type { CaromState, Screen } from "./game";
import type { PointerSample, UpdateApi } from "@clockwyrks/simple-2d";

/** The middle of item `index` on `screen`'s menu. */
function center(screen: Screen, index: number): { x: number; y: number } {
  const rect = menuItemRect(screen, index);
  if (rect === null) throw new Error(`no item ${index} on ${screen}`);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** One sample, with the fields the menus read filled in. */
function sample(
  type: PointerSample["type"],
  at: { x: number; y: number },
  patch: Partial<PointerSample> = {},
): PointerSample {
  return {
    type,
    x: at.x,
    y: at.y,
    id: 1,
    primary: true,
    device: "mouse",
    button: type === "move" ? null : "primary",
    buttons: type === "down" ? ["primary"] : [],
    ...patch,
  };
}

/** Just enough of an `UpdateApi` to hand one frame's samples over. */
function api(samples: PointerSample[]): UpdateApi {
  return {
    input: { pointerSamples: () => samples },
  } as unknown as UpdateApi;
}

/** A state on `screen`, with `menuIndex` where the check wants it. */
function on(screen: Screen, menuIndex = 0): CaromState {
  return { ...createInitialState(), screen, menuIndex };
}

/** One frame of pointer input folded back into the state. */
function frame(state: CaromState, samples: PointerSample[]): CaromState {
  const result = readPointerMenu(state, api(samples));
  return {
    ...state,
    menuIndex: result.menuIndex,
    presses: result.presses,
  };
}

describe("selection", () => {
  it("selects the item a pointer moves onto", () => {
    const result = readPointerMenu(
      on("title"),
      api([sample("move", center("title", 2))]),
    );
    expect(result.menuIndex).toBe(2);
    expect(result.confirmed).toBe(false);
  });

  it("leaves the selection alone while the pointer is over no item", () => {
    const result = readPointerMenu(
      on("title", 1),
      api([sample("move", { x: 10, y: 10 })]),
    );
    expect(result.menuIndex).toBe(1);
  });

  it("takes the item a sweep ENDED on, not one it merely crossed", () => {
    const result = readPointerMenu(
      on("title"),
      api([
        sample("move", center("title", 1)),
        sample("move", center("title", 2)),
      ]),
    );
    expect(result.menuIndex).toBe(2);
  });

  it("does not select on a mouse press, which is not a hover", () => {
    const result = readPointerMenu(
      on("title", 0),
      api([sample("down", center("title", 2))]),
    );
    expect(result.menuIndex).toBe(0);
    expect(result.confirmed).toBe(false);
  });

  it("selects on a finger's landing, because a finger cannot hover", () => {
    const result = readPointerMenu(
      on("title", 0),
      api([sample("down", center("title", 2), { device: "touch" })]),
    );
    expect(result.menuIndex).toBe(2);
    expect(result.confirmed).toBe(false);
  });

  it("selects on a finger travelling onto an item", () => {
    const landed = frame(on("title", 0), [
      sample("down", { x: 10, y: 10 }, { device: "touch" }),
    ]);
    const result = readPointerMenu(
      landed,
      api([sample("move", center("title", 1), { device: "touch" })]),
    );
    expect(result.menuIndex).toBe(1);
  });
});

describe("confirming", () => {
  it("confirms a press and release inside one item, on one frame", () => {
    const at = center("title", 1);
    const result = readPointerMenu(
      on("title", 0),
      api([sample("down", at), sample("up", at)]),
    );
    expect(result.confirmed).toBe(true);
    expect(result.menuIndex).toBe(1);
  });

  it("confirms across two frames, remembering where the press landed", () => {
    const at = center("title", 2);
    const pressed = frame(on("title", 0), [sample("down", at)]);
    expect(pressed.presses).toHaveLength(1);

    const result = readPointerMenu(pressed, api([sample("up", at)]));
    expect(result.confirmed).toBe(true);
    expect(result.menuIndex).toBe(2);
    expect(result.presses).toEqual([]);
  });

  it("confirms nothing when the two edges name different items", () => {
    const pressed = frame(on("title", 0), [sample("down", center("title", 0))]);
    const result = readPointerMenu(
      pressed,
      api([
        sample("move", center("title", 1), { buttons: ["primary"] }),
        sample("up", center("title", 1)),
      ]),
    );
    expect(result.confirmed).toBe(false);
    // The travel still moved the highlight, which is what the player sees.
    expect(result.menuIndex).toBe(1);
  });

  it("confirms nothing when the press began outside every item", () => {
    const pressed = frame(on("title", 0), [sample("down", { x: 10, y: 10 })]);
    const result = readPointerMenu(
      pressed,
      api([sample("up", center("title", 1))]),
    );
    expect(result.confirmed).toBe(false);
  });

  it("confirms nothing when the release lands outside every item", () => {
    const at = center("title", 1);
    const pressed = frame(on("title", 0), [sample("down", at)]);
    const result = readPointerMenu(
      pressed,
      api([sample("up", { x: 10, y: 10 })]),
    );
    expect(result.confirmed).toBe(false);
  });

  it("confirms nothing when a release has no press behind it", () => {
    const at = center("title", 1);
    const result = readPointerMenu(on("title", 0), api([sample("up", at)]));
    expect(result.confirmed).toBe(false);
    expect(result.menuIndex).toBe(0);
  });

  it("confirms a finger that lands and lifts inside one item", () => {
    const at = center("matchover", 1);
    const result = readPointerMenu(
      on("matchover", 0),
      api([
        sample("down", at, { device: "touch" }),
        sample("up", at, { device: "touch" }),
      ]),
    );
    expect(result.confirmed).toBe(true);
    expect(result.menuIndex).toBe(1);
  });

  it("keeps a second contact's press to itself", () => {
    const first = center("title", 0);
    const second = center("title", 2);
    const pressed = frame(on("title", 0), [
      sample("down", first, { device: "touch", id: 7 }),
      sample("down", second, { device: "touch", id: 8 }),
    ]);
    expect(pressed.presses).toHaveLength(2);

    const result = readPointerMenu(
      pressed,
      api([sample("up", second, { device: "touch", id: 8 })]),
    );
    expect(result.confirmed).toBe(true);
    expect(result.menuIndex).toBe(2);
    // The other finger is still down, still waiting for its own release.
    expect(result.presses.map((press) => press.id)).toEqual([7]);
  });

  it("confirms nothing once the screen the press landed on has changed", () => {
    const at = center("title", 1);
    const pressed = frame(on("title", 0), [sample("down", at)]);
    const moved: CaromState = { ...pressed, screen: "matchover" };
    const result = readPointerMenu(moved, api([sample("up", at)]));
    expect(result.confirmed).toBe(false);
  });
});

describe("a screen with no menu", () => {
  it("selects nothing, confirms nothing, and drops every waiting press", () => {
    const at = center("title", 1);
    const pressed = frame(on("title", 0), [sample("down", at)]);
    const live: CaromState = { ...pressed, screen: "playing", menuIndex: 3 };
    const result = readPointerMenu(live, api([sample("up", at)]));
    expect(result).toEqual({ menuIndex: 3, presses: [], confirmed: false });
  });
});

describe("the state it is handed", () => {
  it("is never written", () => {
    const at = center("title", 1);
    const before = frame(on("title", 0), [sample("down", at)]);
    const frozen = JSON.stringify(before);
    readPointerMenu(before, api([sample("up", at)]));
    expect(JSON.stringify(before)).toBe(frozen);
  });
});
