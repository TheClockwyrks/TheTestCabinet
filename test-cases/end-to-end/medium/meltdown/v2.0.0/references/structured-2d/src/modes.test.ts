// The five modes, the three difficulties, and the figures each of them fixes.

import { describe, expect, it } from "vitest";
import {
  BOTTLENECK_ZONE,
  DIFFICULTY_TABLE,
  HUNDRED_HP_SCALE,
  HUNDRED_UNITS,
  MODE_TABLE,
  START_LIVES,
  SUDDEN_DEATH_LIVES,
  SURGE_DEFS,
  WAVE_CYCLE,
  WAVE_SPAWN_INTERVAL,
  waveSize,
  waveType,
} from "./constants";
import {
  nextWaveInfo,
  releaseTypeFor,
  waveSizeFor,
  waveTypeFor,
} from "./waves";
import { meltdownState } from "./game";
import { createHarness, startRun, stepSeconds } from "./harness";

describe("the derived figures", () => {
  it("follows the mode and the difficulty, and nothing else", async () => {
    const harness = await createHarness();
    const rows: [
      Parameters<typeof harness.debug.setMode>[0],
      Parameters<typeof harness.debug.setDifficulty>[0],
      number,
      number,
      number,
      boolean,
    ][] = [
      ["containment", "easy", 350, 15, 20, true],
      ["containment", "medium", 250, 20, 20, true],
      ["containment", "hard", 200, 26, 20, true],
      ["hundred", "medium", 600, 1, 20, false],
      ["deeppockets", "medium", 10000, 20, 20, false],
      ["bottleneck", "medium", 300, 20, 20, true],
      ["suddendeath", "medium", 300, 20, 1, true],
    ];
    for (const [mode, difficulty, money, waves, lives, interest] of rows) {
      harness.debug.setMode(mode);
      harness.debug.setDifficulty(difficulty);
      const snapshot = harness.debug.snapshot();
      expect(snapshot.startMoney).toBe(money);
      expect(snapshot.waveCount).toBe(waves);
      expect(snapshot.startLives).toBe(lives);
      expect(snapshot.interest).toBe(interest);
    }
    harness.dispose();
  });

  it("leaves the run's live money, lives and wave alone", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setMoney(77);
    harness.debug.setLives(9);
    harness.debug.setWave(4);
    harness.debug.setMode("deeppockets");
    harness.debug.setDifficulty("hard");
    const snapshot = harness.debug.snapshot();
    expect(snapshot.money).toBe(77);
    expect(snapshot.lives).toBe(9);
    expect(snapshot.wave).toBe(4);
    expect(snapshot.startMoney).toBe(10000);
    harness.dispose();
  });

  it("changes the starting money and the wave count alone across the difficulties", () => {
    expect(MODE_TABLE.containment.startLives).toBe(START_LIVES);
    expect(MODE_TABLE.suddendeath.startLives).toBe(SUDDEN_DEATH_LIVES);
    for (const row of Object.values(DIFFICULTY_TABLE)) {
      expect(row.money).toBeGreaterThan(0);
      expect(row.waves).toBeGreaterThan(0);
    }
    expect(MODE_TABLE.containment.buildZone).toBeNull();
  });

  it("reports a build zone on Bottleneck alone", async () => {
    const harness = await createHarness();
    for (const mode of [
      "containment",
      "hundred",
      "deeppockets",
      "suddendeath",
    ] as const) {
      harness.debug.setMode(mode);
      expect(harness.debug.snapshot().buildZone).toBeNull();
    }
    harness.debug.setMode("bottleneck");
    expect(harness.debug.snapshot().buildZone).toEqual({
      col0: BOTTLENECK_ZONE.col0,
      row0: BOTTLENECK_ZONE.row0,
      col1: BOTTLENECK_ZONE.col1,
      row1: BOTTLENECK_ZONE.row1,
    });
    harness.dispose();
  });
});

describe("Bottleneck", () => {
  it("allows a footprint wholly inside the zone", async () => {
    const harness = await createHarness();
    startRun(harness, "bottleneck");
    harness.debug.setArmed("arc");
    harness.debug.setPreview(BOTTLENECK_ZONE.col0, BOTTLENECK_ZONE.row0);
    expect(harness.debug.snapshot().build?.valid).toBe(true);
    harness.debug.setPreview(
      BOTTLENECK_ZONE.col1 - 1,
      BOTTLENECK_ZONE.row1 - 1,
    );
    expect(harness.debug.snapshot().build?.valid).toBe(true);
    harness.dispose();
  });

  it("refuses a footprint with a single tile outside the zone", async () => {
    const harness = await createHarness();
    startRun(harness, "bottleneck");
    harness.debug.setArmed("arc");
    harness.debug.setPreview(BOTTLENECK_ZONE.col0 - 1, BOTTLENECK_ZONE.row0);
    expect(harness.debug.snapshot().build?.valid).toBe(false);
    harness.debug.setPreview(BOTTLENECK_ZONE.col1, BOTTLENECK_ZONE.row1);
    expect(harness.debug.snapshot().build?.valid).toBe(false);
    harness.debug.place();
    expect(harness.debug.snapshot().towers).toHaveLength(0);
    harness.dispose();
  });

  it("leaves the floor outside the zone open for the surge", async () => {
    const harness = await createHarness();
    startRun(harness, "bottleneck");
    const paths = harness.debug.snapshot().paths;
    expect(paths.left.length).toBeGreaterThan(0);
    expect(Number.isFinite(paths.left.length)).toBe(true);
    expect(Number.isFinite(paths.top.length)).toBe(true);
    harness.dispose();
  });
});

describe("The Hundred", () => {
  it("runs one wave of exactly a hundred units", async () => {
    const harness = await createHarness();
    startRun(harness, "hundred");
    const state = meltdownState(harness.engine.world);
    expect(waveSizeFor(state, 1)).toBe(HUNDRED_UNITS);
    expect(harness.debug.snapshot().waveCount).toBe(1);
    harness.dispose();
  });

  it("cycles the five non-boss types one unit at a time", async () => {
    const harness = await createHarness();
    startRun(harness, "hundred");
    harness.debug.setPhase("wave");
    harness.debug.setWaveSpawning(true);
    harness.debug.setWavePending(HUNDRED_UNITS);
    await stepSeconds(harness, WAVE_SPAWN_INTERVAL * 6, 360);
    const surge = harness.debug.snapshot().surge;
    expect(surge.length).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < 6; i += 1) {
      expect(surge[i].type).toBe(WAVE_CYCLE[i % WAVE_CYCLE.length]);
    }
    harness.dispose();
  });

  it("names the release order off the units still owed", async () => {
    const harness = await createHarness();
    startRun(harness, "hundred");
    const state = meltdownState(harness.engine.world);
    for (const [released, type] of WAVE_CYCLE.entries()) {
      state.wavePending = HUNDRED_UNITS - released;
      expect(releaseTypeFor(state)).toBe(type);
    }
    harness.dispose();
  });

  it("scales every unit's hp by the flat factor, wherever it arrives", async () => {
    const harness = await createHarness();
    startRun(harness, "hundred");
    harness.debug.setWave(1);
    harness.debug.addUnit("hulk", "left");
    const first = harness.debug.snapshot().surge[0];
    expect(first.maxHp).toBeCloseTo(SURGE_DEFS.hulk.hp * HUNDRED_HP_SCALE, 6);
    // The wave number does not move it: there is one wave.
    harness.debug.setWave(9);
    harness.debug.addUnit("mote", "top");
    const surge = harness.debug.snapshot().surge;
    expect(surge[surge.length - 1].maxHp).toBeCloseTo(
      SURGE_DEFS.mote.hp * HUNDRED_HP_SCALE,
      6,
    );
    harness.dispose();
  });

  it("has no build phase between waves, because it has one wave", () => {
    expect(MODE_TABLE.hundred.buildPhases).toBe(false);
  });

  it("previews the onslaught as its first type and its full count", async () => {
    const harness = await createHarness();
    startRun(harness, "hundred");
    harness.debug.setPhase("opening");
    const next = harness.debug.snapshot().nextWave;
    expect(next).toEqual({ type: WAVE_CYCLE[0], count: HUNDRED_UNITS });
    harness.dispose();
  });
});

describe("the coming wave", () => {
  it("names the wave a build or opening phase is preparing for", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setWave(6);
    harness.debug.setPhase("building");
    expect(harness.debug.snapshot().nextWave).toEqual({
      type: waveType(6, 20),
      count: waveSize(6, 20),
    });
    harness.dispose();
  });

  it("names the wave after the one being fought during a wave", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setWave(6);
    harness.debug.setPhase("wave");
    expect(harness.debug.snapshot().nextWave).toEqual({
      type: waveType(7, 20),
      count: waveSize(7, 20),
    });
    harness.dispose();
  });

  it("reads null while the run's last wave is being fought", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setWave(20);
    harness.debug.setPhase("wave");
    expect(harness.debug.snapshot().nextWave).toBeNull();
    harness.debug.setPhase("building");
    expect(harness.debug.snapshot().nextWave).not.toBeNull();
    harness.dispose();
  });

  it("agrees with the closed forms on every wave of a run", async () => {
    const harness = await createHarness();
    startRun(harness, "containment", "hard");
    const state = meltdownState(harness.engine.world);
    for (let w = 1; w <= 26; w += 1) {
      expect(waveTypeFor(state, w)).toBe(waveType(w, 26));
      expect(waveSizeFor(state, w)).toBe(waveSize(w, 26));
    }
    expect(waveTypeFor(state, 13)).toBe("core");
    expect(waveTypeFor(state, 26)).toBe("core");
    expect(nextWaveInfo(state)).not.toBeNull();
    harness.dispose();
  });
});
