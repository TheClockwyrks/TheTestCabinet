// The surge: how it crosses the floor, what leaving costs, and what a wave is.

import { describe, expect, it } from "vitest";
import {
  SURGE_DEFS,
  WAVE_CYCLE,
  WAVE_OPENING,
  WAVE_SPAWN_INTERVAL,
  hpScale,
  tileCX,
  tileCY,
  waveSize,
  waveType,
} from "./constants";
import { exhaustPoint } from "./geometry";
import {
  createHarness,
  poseTower,
  startRun,
  stepSeconds,
  type Harness,
} from "./harness";

function lastUnit(harness: Harness) {
  const surge = harness.debug.snapshot().surge;
  return surge[surge.length - 1];
}

function addWalker(
  harness: Harness,
  type: Parameters<Harness["debug"]["addUnit"]>[0],
  vent: "left" | "top" = "left",
): number {
  harness.debug.addUnit(type, vent);
  return lastUnit(harness).id;
}

function unitOf(harness: Harness, id: number) {
  return harness.debug.snapshot().surge.find((u) => u.id === id) ?? null;
}

describe("entering the floor", () => {
  it("arrives on an open opening tile of its vent, bound for the opposite", async () => {
    const harness = await createHarness();
    startRun(harness);
    const left = addWalker(harness, "mote", "left");
    const top = addWalker(harness, "mote", "top");
    expect(unitOf(harness, left)).toMatchObject({
      col: 0,
      row: 16,
      vent: "left",
      exhaust: "right",
    });
    expect(unitOf(harness, top)).toMatchObject({
      col: 22,
      row: 0,
      vent: "top",
      exhaust: "bottom",
    });
    harness.dispose();
  });

  it("never appears on an opening tile a footprint has covered", async () => {
    const harness = await createHarness();
    startRun(harness);
    // A 2x2 over the first two rows of the left vent.
    poseTower(harness, "arc", 0, 16, 0);
    const id = addWalker(harness, "mote", "left");
    expect(unitOf(harness, id)?.row).toBe(18);
    harness.dispose();
  });

  it("scales hp with the wave, and scales nothing else", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setWave(5);
    const id = addWalker(harness, "mote");
    const read = unitOf(harness, id);
    expect(read?.maxHp).toBeCloseTo(SURGE_DEFS.mote.hp * hpScale(5), 8);
    expect(read?.hp).toBe(read?.maxHp);
    expect(read?.baseSpeed).toBe(SURGE_DEFS.mote.speed);
    harness.dispose();
  });
});

describe("crossing the floor", () => {
  it("walks at its own speed", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = addWalker(harness, "mote");
    harness.debug.setUnitPosition(id, tileCX(5), tileCY(17));
    await stepSeconds(harness, 1, 20);
    const read = unitOf(harness, id);
    expect(read?.x).toBeCloseTo(tileCX(5) + SURGE_DEFS.mote.speed, 6);
    expect(read?.y).toBeCloseTo(tileCY(17), 6);
    harness.dispose();
  });

  it("holds its position with the motion gate off, and still re-paths", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = addWalker(harness, "mote");
    harness.debug.setUnitPosition(id, tileCX(5), tileCY(17));
    harness.debug.setUnitMotion(id, false);
    const before = unitOf(harness, id);
    await stepSeconds(harness, 1, 20);
    const after = unitOf(harness, id);
    expect(after?.x).toBe(before?.x);
    expect(after?.remaining).toBe(before?.remaining);

    // A wall across its route lengthens `remaining` without moving it.
    poseTower(harness, "lance", 25, 16, 0);
    const walled = unitOf(harness, id);
    expect(walled?.x).toBe(before?.x);
    expect(walled?.remaining ?? 0).toBeGreaterThan(before?.remaining ?? 0);
    harness.dispose();
  });

  it("flies straight to its exhaust, over every wall", async () => {
    const harness = await createHarness();
    startRun(harness);
    poseTower(harness, "lance", 25, 16, 0);
    const id = addWalker(harness, "drift", "left");
    const start = unitOf(harness, id);
    const target = exhaustPoint("right");
    await stepSeconds(harness, 1, 20);
    const after = unitOf(harness, id);
    const travelled = Math.hypot(
      (after?.x ?? 0) - (start?.x ?? 0),
      (after?.y ?? 0) - (start?.y ?? 0),
    );
    expect(travelled).toBeCloseTo(SURGE_DEFS.drift.speed, 6);
    // Still exactly on the line from where it entered to the exhaust point.
    const cross =
      (target.x - (start?.x ?? 0)) * ((after?.y ?? 0) - (start?.y ?? 0)) -
      (target.y - (start?.y ?? 0)) * ((after?.x ?? 0) - (start?.x ?? 0));
    expect(Math.abs(cross)).toBeLessThan(1e-6);
    expect(after?.flying).toBe(true);
    harness.dispose();
  });
});

describe("leaving the floor", () => {
  it("costs its leak value in lives and pays no bounty", async () => {
    const harness = await createHarness();
    startRun(harness);
    const before = harness.debug.snapshot();
    const id = addWalker(harness, "hulk");
    harness.debug.setUnitPosition(id, tileCX(49), tileCY(17));
    await stepSeconds(harness, 1 / 120, 1);
    const after = harness.debug.snapshot();
    expect(after.surge).toHaveLength(0);
    expect(after.lives).toBe(before.lives - SURGE_DEFS.hulk.leak);
    expect(after.money).toBe(before.money);
    expect(after.score).toBe(before.score);
    harness.dispose();
  });

  it("costs five lives for a Core", async () => {
    const harness = await createHarness();
    startRun(harness);
    const before = harness.debug.snapshot().lives;
    const id = addWalker(harness, "core");
    harness.debug.setUnitPosition(id, tileCX(49), tileCY(18));
    await stepSeconds(harness, 1 / 120, 1);
    expect(harness.debug.snapshot().lives).toBe(before - SURGE_DEFS.core.leak);
    harness.dispose();
  });
});

describe("the wave progression", () => {
  it("reads the opening list, then the cycle, with the two milestones", () => {
    for (let wave = 1; wave <= 8; wave += 1) {
      if (wave === 10 || wave === 20) continue;
      expect(waveType(wave, 20)).toBe(WAVE_OPENING[wave - 1]);
    }
    expect(waveType(9, 20)).toBe(WAVE_CYCLE[0]);
    expect(waveType(11, 20)).toBe(WAVE_CYCLE[2]);
    expect(waveType(10, 20)).toBe("core");
    expect(waveType(20, 20)).toBe("core");
    expect(waveSize(10, 20)).toBe(1);
    expect(waveSize(1, 20)).toBe(12);
    expect(waveSize(19, 20)).toBe(Math.ceil(12 * (1 + 0.22 * 18)));
  });

  it("releases one unit every interval, the first on the frame it begins", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setWaveSpawning(true);
    harness.tap("Space");
    await stepSeconds(harness, 1 / 240, 1);
    let snapshot = harness.debug.snapshot();
    expect(snapshot.phase).toBe("wave");
    expect(snapshot.surge).toHaveLength(1);
    expect(snapshot.wavePending).toBe(11);
    expect(snapshot.waveRemaining).toBe(12);

    await stepSeconds(harness, WAVE_SPAWN_INTERVAL, 20);
    snapshot = harness.debug.snapshot();
    expect(12 - snapshot.wavePending).toBe(2);
    expect(snapshot.surge).toHaveLength(2);
    harness.dispose();
  });

  it("fields one type in Containment", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setWaveSpawning(true);
    harness.tap("Space");
    await stepSeconds(harness, WAVE_SPAWN_INTERVAL * 4, 60);
    const types = new Set(harness.debug.snapshot().surge.map((u) => u.type));
    expect([...types]).toEqual(["mote"]);
    harness.dispose();
  });

  it("draws each unit's vent from the seed, and replays it", async () => {
    const harness = await createHarness();
    const run = async (seed: number): Promise<string[]> => {
      harness.debug.reset(seed);
      startRun(harness);
      harness.debug.reset(seed);
      harness.debug.setScreen("playing");
      harness.debug.setPhase("building");
      harness.debug.setWaveSpawning(true);
      harness.tap("Space");
      await stepSeconds(harness, WAVE_SPAWN_INTERVAL * 5, 60);
      return harness.debug.snapshot().surge.map((unit) => unit.vent);
    };
    const first = await run(7);
    const second = await run(7);
    const other = await run(99);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(3);
    expect(new Set([...first, ...other]).size).toBe(2);
    harness.dispose();
  });
});
