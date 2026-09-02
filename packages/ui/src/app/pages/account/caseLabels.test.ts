import { describe, expect, it } from "vitest";
import {
  caseEngine,
  caseEngineLabel,
  caseLabel,
  caseQualifier,
  pinnedEngine,
  samePinnedCase,
} from "./caseLabels";

const pin = { slug: "carom", version: "v1.0.0", variant: "base" };

// A pin's engine is optional on the wire and resolved everywhere else, and the two
// spellings of "the engineless run" have to be one pin on every surface that keys,
// compares or names one.
describe("caseEngine", () => {
  it("resolves an absent engine to the engineless run", () => {
    expect(caseEngine(pin)).toBe("none");
    expect(caseEngine({ ...pin, engine: null })).toBe("none");
    // Whitespace is a pin holding nothing, exactly as the server reads it.
    expect(caseEngine({ ...pin, engine: "  " })).toBe("none");
  });

  it("keeps a named engine as the slug it names", () => {
    expect(caseEngine({ ...pin, engine: "simple-2d" })).toBe("simple-2d");
  });
});

describe("pinnedEngine", () => {
  // The two are the same pin to the server, and a plan authored today should be
  // byte-identical on the wire to one authored before a pin carried an engine.
  it("writes nothing for the engineless run", () => {
    expect(pinnedEngine("none")).toEqual({});
  });

  it("writes a named engine", () => {
    expect(pinnedEngine("simple-2d")).toEqual({ engine: "simple-2d" });
  });
});

describe("samePinnedCase", () => {
  it("treats an absent engine and `none` as one pin", () => {
    expect(samePinnedCase(pin, { ...pin, engine: "none" })).toBe(true);
  });

  it("treats two engines as two pins", () => {
    // The runs are not comparable, so a plan is entitled to hold both and the add
    // refusal must not swallow the second.
    expect(
      samePinnedCase({ ...pin, engine: "simple-2d" }, { ...pin, engine: null }),
    ).toBe(false);
  });

  it("still separates two variants and two versions", () => {
    expect(samePinnedCase(pin, { ...pin, variant: "hard" })).toBe(false);
    expect(samePinnedCase(pin, { ...pin, version: "v1.1.0" })).toBe(false);
  });
});

// The rule every surface follows: name the engine only when it is not the engineless
// `none`. Every pin has an engine, so spelling out the ordinary one would add a word
// to every label on every screen and distinguish nothing.
describe("the engine-naming rule", () => {
  it("says nothing about the engineless run", () => {
    expect(caseEngineLabel(pin)).toBe("");
    expect(caseQualifier(pin)).toBe("base · v1.0.0");
    expect(caseLabel("Carom", pin)).toBe("Carom · base · v1.0.0");
  });

  it("names a chosen engine, as the catalog names it", () => {
    const engined = { ...pin, engine: "simple-2d" };
    expect(caseEngineLabel(engined)).toBe("Simple 2D");
    expect(caseQualifier(engined)).toBe("base · v1.0.0 · Simple 2D");
    expect(caseLabel("Carom", engined)).toBe(
      "Carom · base · v1.0.0 · Simple 2D",
    );
  });

  it("falls back to the slug for an engine this console predates", () => {
    // A console older than the backend it is pointed at still has to name the pin it
    // was handed, and the slug is what the plan actually recorded.
    expect(caseEngineLabel({ ...pin, engine: "voxel-3d" })).toBe("voxel-3d");
  });
});
