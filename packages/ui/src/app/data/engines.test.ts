import { describe, expect, it } from "vitest";

import {
  DEFAULT_ENGINE_SLUG,
  ENGINES,
  engineName,
  orderEngines,
} from "./engines";

describe("the engine catalog", () => {
  it("mirrors core's built-in engines in catalog order", () => {
    // This list is a mirror of `engines/<slug>/engine.toml` and of
    // `BUILT_IN_SLUGS` in `crates/core/src/engine.rs`. Pinning it here is what
    // makes a drift between the two halves a test failure rather than a label
    // that quietly falls back to a raw slug in the console.
    expect(ENGINES.map((engine) => engine.slug)).toEqual([
      "none",
      "simple-2d",
      "structured-2d",
      "simple-3d",
      "structured-3d",
    ]);
    expect(ENGINES.map((engine) => engine.name)).toEqual([
      "None",
      "Simple 2D",
      "Structured 2D",
      "Simple 3D",
      "Structured 3D",
    ]);
  });

  it("leads with the default engine", () => {
    expect(DEFAULT_ENGINE_SLUG).toBe("none");
    expect(ENGINES[0]?.slug).toBe(DEFAULT_ENGINE_SLUG);
  });
});

describe("engineName", () => {
  it("names every engine the catalog carries", () => {
    expect(engineName("simple-3d")).toBe("Simple 3D");
    expect(engineName("structured-3d")).toBe("Structured 3D");
  });

  it("falls back to the slug itself for an engine it does not know", () => {
    // A console built before an engine landed still has the slug the run
    // recorded, which is more use than an empty label.
    expect(engineName("decoupled-3d")).toBe("decoupled-3d");
  });
});

describe("orderEngines", () => {
  it("puts the slugs it knows into catalog order", () => {
    expect(orderEngines(["structured-3d", "none", "simple-2d"])).toEqual([
      "none",
      "simple-2d",
      "structured-3d",
    ]);
  });

  it("appends the slugs it does not know, in the order given", () => {
    expect(orderEngines(["decoupled-3d", "simple-3d", "decoupled-2d"])).toEqual(
      ["simple-3d", "decoupled-3d", "decoupled-2d"],
    );
  });
});
