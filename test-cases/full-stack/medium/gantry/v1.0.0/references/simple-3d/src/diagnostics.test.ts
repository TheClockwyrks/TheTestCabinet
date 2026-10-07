// The values the overlay shows: that each is registered, short, and a pure read.

import { describe, expect, it } from "vitest";
import { DIAGNOSTICS } from "./diagnostics";
import { openSite, titleState } from "./state";

describe("the diagnostic sources", () => {
  it("name every value `specs/instrumentation.md` asks for", () => {
    const names = DIAGNOSTICS.map((source) => source.name);
    for (const wanted of [
      "screen",
      "site",
      "members",
      "cost",
      "issues",
      "run",
      "step",
      "clock",
      "cause",
      "slew",
      "trolley",
      "hoist",
      "grip",
      "bob",
      "util",
      "broken",
      "camera",
    ]) {
      expect(names).toContain(wanted);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it("read a value of one of the three types the overlay draws", () => {
    const state = openSite(titleState(), 2);
    for (const source of DIAGNOSTICS) {
      const value = source.read(state);
      expect(["string", "number", "boolean"]).toContain(typeof value);
      if (typeof value === "string") expect(value.length).toBeLessThan(48);
    }
  });

  it("name a word rather than going missing where the thing is absent", () => {
    const cause = DIAGNOSTICS.find((source) => source.name === "cause");
    expect(cause?.read(titleState())).toBe("-");
  });

  it("are pure: reading them leaves the state as it is", () => {
    const state = openSite(titleState(), 0);
    const copy = structuredClone(state);
    for (const source of DIAGNOSTICS) source.read(state);
    expect(state).toEqual(copy);
  });

  it("read the state they are handed rather than one they closed over", () => {
    const screen = DIAGNOSTICS.find((source) => source.name === "screen");
    expect(screen?.read(titleState())).toBe("title");
    expect(screen?.read(openSite(titleState(), 0))).toBe("title");
    const site = DIAGNOSTICS.find((source) => source.name === "site");
    expect(String(site?.read(openSite(titleState(), 3)))).toContain(
      "Long Reach",
    );
  });
});
