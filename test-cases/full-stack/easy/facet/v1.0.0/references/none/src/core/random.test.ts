// The game's random source: uniform over the list it is handed.

import { describe, expect, it } from "vitest";
import { GEM_KINDS } from "../constants";
import { randomPicker } from "./random";

describe("randomPicker", () => {
  it("picks every kind eventually, and only kinds", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(randomPicker.pick(GEM_KINDS));
    expect([...seen].sort()).toEqual([...GEM_KINDS].sort());
  });

  it("picks the one item of a single-item list", () => {
    for (let i = 0; i < 20; i++)
      expect(randomPicker.pick(["only"])).toBe("only");
  });
});
