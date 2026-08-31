// The diagnostic sources: over a bare state, and registered with a real
// engine's overlay registry and read back through `engine.diagnostics()`.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diagnosticSources } from "./diagnostics";
import { startRun } from "./flow";
import { createHarness, type Harness } from "./harness";
import { formatClock } from "./render/hud";
import { SWITCH_NAMES, initialState } from "./state";

/** The sources' readings as a name-to-value map. */
function readings(
  sources: [string, () => string | number | boolean][],
): Map<string, string | number | boolean> {
  return new Map(sources.map(([name, read]) => [name, read()]));
}

describe("the run clock", () => {
  it("formats whole seconds as m:ss", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(9.99)).toBe("0:09");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(600)).toBe("10:00");
  });
});

describe("the game's sources", () => {
  it("report the facts the snapshot reports, read fresh at each call", () => {
    const state = initialState(1);
    const sources = diagnosticSources(() => state);
    const idle = readings(sources);
    expect(idle.get("screen")).toBe("title");
    expect(idle.get("clock")).toBe("0:00 (tick 0)");
    expect(idle.get("weapons")).toBe("none");
    for (const name of SWITCH_NAMES) expect(idle.get(name)).toBe(true);
    expect(idle.get("muted")).toBe(false);

    startRun(state);
    state.run.tick = 90;
    state.run.kills = 7;
    state.run.pendingLevelUps = 2;
    state.spawning = false;
    const live = readings(sources);
    expect(live.get("screen")).toBe("playing");
    expect(live.get("clock")).toBe("0:01 (tick 90)");
    expect(live.get("level")).toBe("1  xp 0.0 / 5");
    expect(live.get("hp")).toBe("100.0 / 100");
    expect(live.get("kills")).toBe(7);
    expect(live.get("lamplighter")).toBe("0.0, 0.0 right");
    expect(live.get("enemies")).toBe("0  window 0");
    expect(live.get("effects")).toBe("0 projectiles, 0 zones");
    expect(live.get("gems")).toBe(0);
    expect(live.get("weapons")).toBe("taper L1 0.00s");
    expect(live.get("passives")).toBe("none");
    expect(live.get("pending")).toBe(2);
    expect(live.get("spawning")).toBe(false);
  });

  it("leave the state as it is when read", () => {
    const state = initialState(1);
    startRun(state);
    const sources = diagnosticSources(() => state);
    const before = JSON.stringify(state);
    readings(sources);
    readings(sources);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("the overlay registry", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
  });

  afterEach(() => {
    h.dispose();
  });

  it("carries every source, read live off the world the mode holds", async () => {
    const names = h.engine.diagnostics().map((reading) => reading.name);
    for (const name of [
      "screen",
      "clock",
      "level",
      "hp",
      "kills",
      "lamplighter",
      "enemies",
      "effects",
      "gems",
      "weapons",
      "passives",
      "pending",
      ...SWITCH_NAMES,
    ]) {
      expect(names).toContain(name);
    }
    h.debug.setSpawning(false);
    h.debug.setScreen("playing");
    h.debug.spawnEnemy("moth", 300, 0);
    h.debug.setEnemyMotion(false);
    await h.step(1);
    const live = new Map(
      h.engine.diagnostics().map((reading) => [reading.name, reading.value]),
    );
    expect(live.get("screen")).toBe("playing");
    expect(live.get("clock")).toBe("0:00 (tick 1)");
    expect(live.get("enemies")).toBe("1  window 0");
    expect(live.get("enemyMotion")).toBe(false);
    for (const reading of h.engine.diagnostics()) {
      expect(reading.error, reading.name).toBeUndefined();
    }
  });
});
