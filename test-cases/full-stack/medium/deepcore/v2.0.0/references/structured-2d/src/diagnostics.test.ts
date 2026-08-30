// The values the debug overlay watches (specs/instrumentation.md, Diagnostics).
//
// The overlay is the engine's, so what is checked here is Deepcore's whole part
// of it: that the sources it registers cover the facts the specification lists,
// that each is a PURE READ of the state it is handed, and that each reads
// something legible from a state posed for it.

import { describe, expect, it } from "vitest";
import { diagnosticSources } from "./diagnostics";
import type { DeepcoreState } from "./game";
import { writeTile } from "./state";
import { bareState, posing, posedAt } from "./test-support";
import { makeTile } from "./world";

/**
 * The sources `registerDiagnostics` would register, over a state of the check's
 * own, with no engine and no world in the way.
 */
function sources(state: DeepcoreState): Map<string, () => unknown> {
  return new Map(diagnosticSources(() => state));
}

/** A state with something to read on every line. */
function posed(): DeepcoreState {
  return posing(bareState(), (d) => {
    d.screen = "in-mine";
    d.panel = "inventory";
    d.credits = 900;
    d.tiers.scanner = 3;
    d.cargo.ferron = 3;
    d.satchel.resonite = 1;
    d.coreTimer = 42;
    d.nodes.push({
      material: "cryenite",
      col: 9,
      row: 202,
      collected: false,
    });
    d.grid = writeTile(d.grid, 8, 202, makeTile("rock", "deepstone"));
    posedAt(d, 8 * 80, 201 * 80);
    d.miner.drilling = { col: 8, row: 202, dir: "down", hitTimer: 0.1 };
    d.scan = {
      locked: true,
      target: "cryenite",
      dirX: 1,
      dirY: 0,
      distanceTiles: 1,
    };
  });
}

describe("the diagnostic sources", () => {
  it("names every fact the specification lists", () => {
    expect([...sources(posed()).keys()]).toEqual([
      "screen",
      "world",
      "miner",
      "pose",
      "fuel",
      "cut",
      "credits",
      "cargo",
      "satchel",
      "tiers",
      "core",
      "scanner",
    ]);
  });

  it("reads each one without changing the state it is handed", () => {
    const state = posed();
    const before = JSON.stringify({ ...state, assets: null });
    for (const [name, read] of sources(state)) {
      const value = read();
      expect(String(value).length, name).toBeGreaterThan(0);
    }
    expect(JSON.stringify({ ...state, assets: null })).toBe(before);
  });

  it("reports the cut, the lock, and the timer that are running", () => {
    const read = sources(posed());
    expect(String(read.get("cut")?.())).toContain("down (8,202)");
    expect(String(read.get("scanner")?.())).toContain("cryenite");
    expect(String(read.get("core")?.())).toContain("42.0");
    expect(String(read.get("screen")?.())).toContain("inventory");
  });

  it("reports the resting values where nothing is running", () => {
    const read = sources(bareState());
    expect(read.get("cut")?.()).toBe("none");
    expect(read.get("scanner")?.()).toBe("no lock");
    expect(read.get("core")?.()).toBe("no sample");
  });
});
