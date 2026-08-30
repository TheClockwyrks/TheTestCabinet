// The values the engine's read-only overlay shows, and that reading them
// leaves the game exactly as it is.

import { describe, expect, it } from "vitest";
import { diagnosticSources } from "./diagnostics";
import { meltdownState } from "./game";
import { createHarness, poseTower, startRun } from "./harness";

describe("the diagnostic sources", () => {
  it("names every value the specification asks for", async () => {
    const harness = await createHarness();
    const names = diagnosticSources(() =>
      meltdownState(harness.engine.world),
    ).map(([name]) => name);
    expect(names).toEqual([
      "screen",
      "mode",
      "run",
      "routes",
      "towers",
      "surge",
    ]);
    harness.dispose();
  });

  it("reads the live game, and each line stays short enough to read", async () => {
    const harness = await createHarness();
    startRun(harness, "bottleneck");
    const id = poseTower(harness, "lance", 20, 12, 1);
    harness.debug.setTowerLevel(id, 2);
    harness.debug.setTowerHeat(id, 61);
    harness.debug.setTowerTripped(id, true);
    harness.debug.addUnit("drift", "top");
    harness.debug.setMoney(410);
    harness.debug.setScore(1200);
    harness.debug.setWave(7);

    const sources = diagnosticSources(() =>
      meltdownState(harness.engine.world),
    );
    const lines = new Map(
      sources.map(([name, read]) => [name, String(read())]),
    );
    expect(lines.get("screen")).toBe("playing / building");
    expect(lines.get("mode")).toBe("bottleneck / medium");
    expect(lines.get("run")).toContain("money 410");
    expect(lines.get("run")).toContain("wave 7/20");
    expect(lines.get("run")).toContain("score 1200");
    expect(lines.get("routes")).toMatch(/^left [\d.]+ {2}top [\d.]+$/);
    expect(lines.get("towers")).toContain(`#${id} lance L2`);
    expect(lines.get("towers")).toContain("TRIPPED");
    expect(lines.get("surge")).toContain("drift");
    for (const value of lines.values()) expect(value.length).toBeLessThan(200);
    harness.dispose();
  });

  it("reads an empty floor without a guard of the game's own", async () => {
    const harness = await createHarness();
    startRun(harness);
    const sources = new Map(
      diagnosticSources(() => meltdownState(harness.engine.world)),
    );
    expect(sources.get("towers")?.()).toBe("none");
    expect(sources.get("surge")?.()).toBe("none");
    harness.dispose();
  });

  it("changes nothing it reads", async () => {
    const harness = await createHarness();
    startRun(harness);
    poseTower(harness, "arc", 10, 10, 0);
    harness.debug.addUnit("mote", "left");
    const before = JSON.stringify(harness.debug.snapshot());
    for (const [, read] of diagnosticSources(() =>
      meltdownState(harness.engine.world),
    )) {
      read();
      read();
    }
    expect(JSON.stringify(harness.debug.snapshot())).toBe(before);
    harness.dispose();
  });
});
