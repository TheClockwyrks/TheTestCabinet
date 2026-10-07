// The forager's desired direction, as the controls leave it.
//
// `desiredDirection` is the whole of Fathom's own input logic: the engine owns
// the keyboard, the binding and the edges, and what is left is deciding which of
// the movement actions being held is the one the forager is asking for.

import { describe, expect, it } from "vitest";
import { desiredDirection } from "./input";
import type { Dir } from "./state";

const NONE: readonly Dir[] = [];

describe("the desired direction", () => {
  it("takes a direction newly pressed", () => {
    expect(desiredDirection(null, NONE, ["right"])).toBe("right");
  });

  it("takes the newest of several pressed at once", () => {
    expect(desiredDirection("right", ["right"], ["right", "up"])).toBe("up");
  });

  it("keeps the one still held when nothing new is pressed", () => {
    expect(desiredDirection("right", ["right", "up"], ["right"])).toBe("right");
  });

  it("falls back to whatever is still held when its own is released", () => {
    expect(desiredDirection("up", ["right", "up"], ["right"])).toBe("right");
  });

  it("holds until another movement action replaces it", () => {
    // Releasing every key leaves the desired direction standing; the forager
    // comes to rest because nothing is held, not because it forgot which way.
    expect(desiredDirection("left", ["left"], NONE)).toBe("left");
    expect(desiredDirection(null, NONE, NONE)).toBeNull();
  });
});
