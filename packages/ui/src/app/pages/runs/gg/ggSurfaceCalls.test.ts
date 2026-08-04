// Joining an offered thing to its calls, and refusing to over-claim.
//
// One asymmetry is the whole subject here. gg records a call under the TOOL, so a positive
// figure on a gate several functions share cannot be attributed to any one of them — while a
// zero on that same gate is exactly attributable, because nothing ran behind it at all. The
// cases below pin both halves, in both directions, since a join that quietly hands the whole
// tool's count to each function looks right on screen and is the one reading these surfaces
// exist to prevent.

import { describe, expect, it } from "vitest";
import {
  sharedSurfaceGates,
  surfaceCallCount,
  surfaceCallPhrase,
} from "./ggSurfaceCalls";

// The catalogue's real shape, small: `read_file` backs three functions across two objects,
// `write_file` backs one, and a view channel is bound behind no tool at all.
const ENTRIES = [
  { name: "fs.readFile", tool: "read_file" },
  { name: "fs.readTextFile", tool: "read_file" },
  { name: "fs.writeFile", tool: "write_file" },
  { name: "view.openFile", tool: "read_file" },
  { name: "view.openText", tool: null },
];

const shared = sharedSurfaceGates(ENTRIES);
const entry = (name: string) => ENTRIES.find((it) => it.name === name)!;

describe("sharedSurfaceGates", () => {
  it("finds a gate its functions share across objects, in offer order", () => {
    // Across objects is the point: `fs.readFile` and `view.openFile` sit on different ones
    // and are the same call on the stream, so a per-object pass would report no sharing at
    // all and hand each of them the tool's whole figure as its own.
    expect([...shared.keys()]).toEqual(["read_file"]);
    expect(shared.get("read_file")).toEqual([
      "fs.readFile",
      "fs.readTextFile",
      "view.openFile",
    ]);
  });

  it("leaves a gate that backs one thing alone", () => {
    // A tool-calling surface is entirely this case — every tool is its own gate — so a map
    // that reported it as shared would put a redundant name on every row of it.
    expect(shared.has("write_file")).toBe(false);
    expect(sharedSurfaceGates([{ name: "grep", tool: "grep" }]).size).toBe(0);
  });
});

describe("surfaceCallCount", () => {
  it("gives a shared gate's figure to the gate, naming what it covers", () => {
    const calls = new Map([["read_file", 12]]);
    for (const name of ["fs.readFile", "fs.readTextFile", "view.openFile"]) {
      expect(surfaceCallCount(entry(name), calls, shared)).toEqual({
        count: 12,
        sharedGate: "read_file",
        sharedWith: ["fs.readFile", "fs.readTextFile", "view.openFile"],
      });
    }
  });

  it("keeps an unshared gate's figure as the entry's own", () => {
    const calls = new Map([["write_file", 3]]);
    expect(surfaceCallCount(entry("fs.writeFile"), calls, shared)).toEqual({
      count: 3,
      sharedGate: null,
      sharedWith: [],
    });
  });

  it("reads zero on a shared gate as each function's own never-called", () => {
    // Nothing was recorded under `read_file`, so none of the three ran — a statement about
    // each of them individually, and the one an ablation is read for.
    expect(surfaceCallCount(entry("fs.readFile"), new Map(), shared)).toEqual({
      count: 0,
      sharedGate: null,
      sharedWith: [],
    });
  });

  it("has no count at all for a function no tool backs", () => {
    // Null rather than zero: zero accuses the agent of ignoring something, and a view call
    // is used without anything ever counting it.
    expect(surfaceCallCount(entry("view.openText"), new Map(), shared)).toEqual(
      {
        count: null,
        sharedGate: null,
        sharedWith: [],
      },
    );
  });
});

describe("surfaceCallPhrase", () => {
  it("never says a function was called when only its gate was", () => {
    const phrase = surfaceCallPhrase(
      "fs.readTextFile",
      surfaceCallCount(
        entry("fs.readTextFile"),
        new Map([["read_file", 12]]),
        shared,
      ),
    );
    expect(phrase).toContain(
      "read_file — the tool behind fs.readFile, fs.readTextFile, view.openFile — was called 12 times",
    );
    expect(phrase).not.toContain("fs.readTextFile was called");
  });

  it("says the three unshared outcomes plainly", () => {
    const calls = new Map([["write_file", 1]]);
    expect(
      surfaceCallPhrase(
        "fs.writeFile",
        surfaceCallCount(entry("fs.writeFile"), calls, shared),
      ),
    ).toBe("fs.writeFile was called 1 time.");
    expect(
      surfaceCallPhrase(
        "fs.writeFile",
        surfaceCallCount(entry("fs.writeFile"), new Map(), shared),
      ),
    ).toBe("fs.writeFile was offered and never called.");
    expect(
      surfaceCallPhrase(
        "view.openText",
        surfaceCallCount(entry("view.openText"), new Map(), shared),
      ),
    ).toBe(
      "view.openText is bound, but nothing behind it is recorded as a tool call, so it has no count.",
    );
  });
});
