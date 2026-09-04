// What the debug overlay reports, against `specs/instrumentation.md`.
//
// The engine draws the panel and holds the registry, and it offers no way to read
// a registered source back, so this check registers Floe's sources against a
// world whose registry it can see: a proxy over the real world that captures the
// registrations and passes every other read through. Each source is then called
// against the live world, which is what the panel does on every draw.

import type { World } from "@test-cabinet/structured-2d";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ROW_MEDIAN, ROW_NEAR, START_COL, TOTAL_LEVELS } from "./constants";
import { registerDiagnostics } from "./diagnostics";
import { createHarness, type Harness } from "./harness.test-support";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

/** Floe's sources, in the order it registers them. */
function sources(world: World): Map<string, () => unknown> {
  const captured = new Map<string, () => unknown>();
  const spy = new Proxy(world, {
    get: (target, key) =>
      key === "diagnostics"
        ? {
            register: (name: string, source: () => unknown) => {
              captured.set(name, source);
            },
          }
        : Reflect.get(target, key, target),
  });
  registerDiagnostics(spy);
  return captured;
}

describe("the overlay's sources", () => {
  it("names the screen, the run, the critter, the bears, the traffic and the bays", () => {
    const captured = sources(harness.engine.world);
    expect([...captured.keys()]).toEqual([
      "screen",
      "level",
      "lives",
      "score",
      "timer",
      "critter",
      "bears",
      "traffic",
      "bays",
    ]);
  });

  it("reads the live game, on one short line each", () => {
    harness.debug.setScreen("playing");
    harness.debug.setPhase("dying");
    harness.debug.setScore(4210);
    harness.debug.setLives(2);
    harness.debug.setLevel(3);
    harness.debug.setReachedLevel(3);
    harness.debug.setTimer(12.34);
    harness.debug.addCritter(START_COL, ROW_NEAR);
    harness.debug.addBear(START_COL, ROW_MEDIAN);
    harness.debug.setBay(1, true);

    const captured = sources(harness.engine.world);
    const read = (name: string): unknown => {
      const source = captured.get(name);
      expect(source).toBeDefined();
      return source?.();
    };

    expect(read("screen")).toBe("playing/dying");
    expect(read("level")).toBe(`3/${TOTAL_LEVELS} reached 3`);
    expect(read("lives")).toBe(2);
    expect(read("score")).toBe(4210);
    expect(read("timer")).toBe(12.3);
    expect(String(read("critter"))).toContain(`tile ${START_COL},${ROW_NEAR}`);
    expect(String(read("critter"))).toContain("solid");
    expect(String(read("bears"))).toContain(`tile ${START_COL},${ROW_MEDIAN}`);
    expect(String(read("traffic"))).toMatch(/^\d+ vehicles, \d+ floes$/);
    expect(read("bays")).toBe(".#...");

    for (const name of captured.keys()) {
      expect(String(read(name)).length).toBeLessThan(220);
    }
  });

  it("reads a strait with no critter and no bear without a guard of its own", () => {
    harness.debug.removeCritter();
    harness.debug.clearBears();
    const captured = sources(harness.engine.world);
    expect(captured.get("critter")?.()).toBe("off the strait");
    expect(captured.get("bears")?.()).toBe("none");
  });

  it("leaves the game exactly as it found it", () => {
    harness.debug.setScreen("playing");
    harness.debug.addCritter(9, 12);
    harness.debug.addBear(9, 14);
    const before = harness.snapshot();
    const captured = sources(harness.engine.world);
    for (const source of captured.values()) source();
    expect(harness.snapshot()).toEqual(before);
  });
});
