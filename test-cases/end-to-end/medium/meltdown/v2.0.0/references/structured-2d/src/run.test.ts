// The run: its three phases, its clocks, its four income lines, and its ends.

import { describe, expect, it } from "vitest";
import {
  BUILD_PHASE_TIME,
  INTEREST_CAP,
  SCORE_VICTORY_PER_LIFE,
  SCORE_WAVE_CLEAR,
  SURGE_DEFS,
  TOWER_DEFS,
  WAVE_CLEAR_BASE,
  WAVE_CLEAR_PER_WAVE,
  WAVE_SPAWN_INTERVAL,
  tileCX,
  tileCY,
} from "./constants";
import { interestOn, waveClearBonus } from "./run";
import {
  createHarness,
  poseTower,
  startRun,
  stepSeconds,
  type Harness,
} from "./harness";

/** A run in its build phase with the run's own release let back on. */
function liveBuildPhase(harness: Harness): void {
  startRun(harness);
  harness.debug.setPhase("building");
  harness.debug.setBuildTimer(BUILD_PHASE_TIME);
  harness.debug.setWaveSpawning(true);
}

describe("the opening phase", () => {
  it("carries no countdown and never starts a wave however long it runs", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setPhase("opening");
    harness.debug.setBuildTimer(0);
    harness.debug.setWaveSpawning(true);
    await stepSeconds(harness, 40, 80);
    const snapshot = harness.debug.snapshot();
    expect(snapshot.phase).toBe("opening");
    expect(snapshot.buildTimer).toBe(0);
    expect(snapshot.surge).toHaveLength(0);
    harness.dispose();
  });
});

describe("a build phase", () => {
  it("counts its timer down one second per second of game time", async () => {
    const harness = await createHarness();
    liveBuildPhase(harness);
    await stepSeconds(harness, 4, 240);
    expect(harness.debug.snapshot().buildTimer).toBeCloseTo(
      BUILD_PHASE_TIME - 4,
      6,
    );
    harness.dispose();
  });

  it("counts down twice as fast at speed 2", async () => {
    const harness = await createHarness();
    liveBuildPhase(harness);
    harness.debug.setSpeed(2);
    await stepSeconds(harness, 2, 120);
    expect(harness.debug.snapshot().buildTimer).toBeCloseTo(
      BUILD_PHASE_TIME - 4,
      6,
    );
    harness.dispose();
  });

  it("starts the wave when the timer reaches zero", async () => {
    const harness = await createHarness();
    liveBuildPhase(harness);
    harness.debug.setBuildTimer(0.5);
    await stepSeconds(harness, 1, 60);
    const snapshot = harness.debug.snapshot();
    expect(snapshot.phase).toBe("wave");
    expect(snapshot.buildTimer).toBe(0);
    expect(snapshot.surge.length).toBeGreaterThan(0);
    harness.dispose();
  });

  it("leaves the phase where it stands with the world gate off", async () => {
    const harness = await createHarness();
    liveBuildPhase(harness);
    harness.debug.setWaveSpawning(false);
    harness.debug.setBuildTimer(0.5);
    await stepSeconds(harness, 2, 120);
    const snapshot = harness.debug.snapshot();
    // The timer still runs down; the phase and the floor do not move.
    expect(snapshot.buildTimer).toBe(0);
    expect(snapshot.phase).toBe("building");
    expect(snapshot.surge).toHaveLength(0);
    harness.dispose();
  });
});

describe("sending", () => {
  it("begins the wave at once, releasing its first unit on that frame", async () => {
    const harness = await createHarness();
    liveBuildPhase(harness);
    harness.tap("Space");
    await harness.engine.advance(1);
    const snapshot = harness.debug.snapshot();
    expect(snapshot.phase).toBe("wave");
    expect(snapshot.surge).toHaveLength(1);
    expect(snapshot.wavePending).toBe(snapshot.waveRemaining - 1);
    harness.dispose();
  });

  it("pays a coin per whole second left on the build timer", async () => {
    const harness = await createHarness();
    liveBuildPhase(harness);
    harness.debug.setBuildTimer(7.9);
    harness.debug.setMoney(100);
    harness.tap("Space");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().money).toBe(107);
    harness.dispose();
  });

  it("pays nothing sending from the untimed opening phase", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setPhase("opening");
    harness.debug.setBuildTimer(0);
    harness.debug.setWaveSpawning(true);
    harness.debug.setMoney(100);
    harness.tap("Space");
    await harness.engine.advance(1);
    const snapshot = harness.debug.snapshot();
    expect(snapshot.money).toBe(100);
    expect(snapshot.phase).toBe("wave");
    harness.dispose();
  });

  it("does nothing with a wave already on the floor", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setPhase("wave");
    harness.debug.setWavePending(3);
    harness.debug.setMoney(50);
    harness.tap("Space");
    await harness.engine.advance(1);
    const snapshot = harness.debug.snapshot();
    expect(snapshot.money).toBe(50);
    expect(snapshot.wavePending).toBe(3);
    harness.dispose();
  });
});

describe("clearing a wave", () => {
  /** One wave of one unit, one shot from dead, on a Lance that cannot miss. */
  async function oneUnitWave(harness: Harness, wave: number): Promise<void> {
    startRun(harness);
    harness.debug.setWave(wave);
    harness.debug.setPhase("wave");
    harness.debug.setWavePending(0);
    const tower = poseTower(harness, "lance", 20, 12, 0);
    harness.debug.setTowerThermal(tower, false);
    harness.debug.setTowerHeat(tower, 100);
    harness.debug.addUnit("mote", "left");
    const surge = harness.debug.snapshot().surge;
    const id = surge[surge.length - 1].id;
    harness.debug.setUnitPosition(id, tileCX(21), tileCY(13));
    harness.debug.setUnitMotion(id, false);
    harness.debug.setUnitMaxHp(id, 1);
    harness.debug.setUnitHp(id, 1);
  }

  it("pays the bonus and the score on the frame its last unit dies", async () => {
    const harness = await createHarness();
    await oneUnitWave(harness, 4);
    harness.debug.setMoney(0);
    harness.debug.setScore(0);
    harness.cues.length = 0;
    await stepSeconds(harness, 2, 120);
    const snapshot = harness.debug.snapshot();
    // The bounty, the wave-clear bonus, and the interest the build phase pays.
    const afterBonus = SURGE_DEFS.mote.bounty + waveClearBonus(4);
    expect(waveClearBonus(4)).toBe(WAVE_CLEAR_BASE + WAVE_CLEAR_PER_WAVE * 4);
    expect(snapshot.money).toBe(afterBonus + interestOn(afterBonus));
    expect(snapshot.score).toBe(
      SURGE_DEFS.mote.bounty + SCORE_WAVE_CLEAR * 4,
    );
    expect(snapshot.wave).toBe(5);
    expect(snapshot.phase).toBe("building");
    // The build phase opened at its full length and has been running since.
    expect(snapshot.buildTimer).toBeGreaterThan(BUILD_PHASE_TIME - 2);
    expect(snapshot.buildTimer).toBeLessThanOrEqual(BUILD_PHASE_TIME);
    expect(harness.cues.map((c) => c.cue)).toContain("wave-clear");
    harness.dispose();
  });

  it("takes its interest on the money the bonus already left", async () => {
    const harness = await createHarness();
    await oneUnitWave(harness, 1);
    harness.debug.setMoney(1000);
    await stepSeconds(harness, 2, 120);
    const before = 1000 + SURGE_DEFS.mote.bounty + waveClearBonus(1);
    expect(harness.debug.snapshot().money).toBe(before + INTEREST_CAP);
    harness.dispose();
  });

  it("pays no interest on a mode whose interest reads false", async () => {
    const harness = await createHarness();
    await oneUnitWave(harness, 1);
    harness.debug.setMode("deeppockets");
    harness.debug.setMoney(1000);
    await stepSeconds(harness, 2, 120);
    expect(harness.debug.snapshot().money).toBe(
      1000 + SURGE_DEFS.mote.bounty + waveClearBonus(1),
    );
    harness.dispose();
  });

  it("never clears a phase that has released no unit", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setPhase("wave");
    harness.debug.setWavePending(0);
    harness.debug.setWave(3);
    await stepSeconds(harness, 5, 120);
    const snapshot = harness.debug.snapshot();
    expect(snapshot.phase).toBe("wave");
    expect(snapshot.wave).toBe(3);
    harness.dispose();
  });

  it("caps the interest at forty", () => {
    expect(interestOn(100)).toBe(8);
    expect(interestOn(499)).toBe(39);
    expect(interestOn(10000)).toBe(INTEREST_CAP);
  });
});

describe("victory and loss", () => {
  it("ends in victory on clearing the final wave, paying for every life", async () => {
    const harness = await createHarness();
    startRun(harness);
    const waveCount = harness.debug.snapshot().waveCount;
    harness.debug.setWave(waveCount);
    harness.debug.setPhase("wave");
    harness.debug.setWavePending(0);
    harness.debug.setLives(7);
    harness.debug.setScore(0);
    const tower = poseTower(harness, "lance", 20, 12, 0);
    harness.debug.setTowerThermal(tower, false);
    harness.debug.setTowerHeat(tower, 100);
    harness.debug.addUnit("mote", "left");
    const surge = harness.debug.snapshot().surge;
    const id = surge[surge.length - 1].id;
    harness.debug.setUnitPosition(id, tileCX(21), tileCY(13));
    harness.debug.setUnitMotion(id, false);
    harness.debug.setUnitMaxHp(id, 1);
    harness.debug.setUnitHp(id, 1);
    harness.cues.length = 0;
    await stepSeconds(harness, 2, 120);
    const snapshot = harness.debug.snapshot();
    expect(snapshot.screen).toBe("victory");
    expect(snapshot.wave).toBe(waveCount);
    expect(snapshot.score).toBe(
      SURGE_DEFS.mote.bounty +
        SCORE_WAVE_CLEAR * waveCount +
        SCORE_VICTORY_PER_LIFE * 7,
    );
    expect(harness.cues.map((c) => c.cue)).toContain("victory");
    harness.dispose();
  });

  it("ends the run at once when a leak takes the lives to zero", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setPhase("wave");
    harness.debug.setWavePending(0);
    harness.debug.setLives(1);
    harness.debug.addUnit("mote", "left");
    const surge = harness.debug.snapshot().surge;
    const id = surge[surge.length - 1].id;
    harness.debug.setUnitPosition(id, tileCX(48), tileCY(17));
    harness.cues.length = 0;
    await stepSeconds(harness, 1, 60);
    const snapshot = harness.debug.snapshot();
    expect(snapshot.screen).toBe("gameover");
    expect(snapshot.lives).toBe(0);
    expect(harness.cues.map((c) => c.cue)).toContain("game-over");
    harness.dispose();
  });

  it("loses rather than wins when the fatal leak is on the final wave", async () => {
    const harness = await createHarness();
    startRun(harness);
    const waveCount = harness.debug.snapshot().waveCount;
    harness.debug.setWave(waveCount);
    harness.debug.setPhase("wave");
    harness.debug.setWavePending(0);
    harness.debug.setLives(1);
    harness.debug.addUnit("mote", "left");
    const surge = harness.debug.snapshot().surge;
    const id = surge[surge.length - 1].id;
    harness.debug.setUnitPosition(id, tileCX(48), tileCY(17));
    await stepSeconds(harness, 1, 60);
    expect(harness.debug.snapshot().screen).toBe("gameover");
    harness.dispose();
  });
});

describe("pause and speed", () => {
  it("holds the whole simulation still while the game is paused", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setPhase("wave");
    harness.debug.setBuildTimer(9);
    const tower = poseTower(harness, "arc", 20, 12, 0);
    harness.debug.setTowerHeat(tower, 60);
    harness.debug.addUnit("mote", "left");
    const surge = harness.debug.snapshot().surge;
    const id = surge[surge.length - 1].id;

    harness.debug.setScreen("paused");
    const before = harness.debug.snapshot();
    await stepSeconds(harness, 3, 180);
    const after = harness.debug.snapshot();
    expect(after.simTime).toBeCloseTo(before.simTime, 10);
    expect(after.surge.find((u) => u.id === id)?.x).toBeCloseTo(
      before.surge.find((u) => u.id === id)?.x ?? -1,
      10,
    );
    expect(after.towers[0].heat).toBeCloseTo(before.towers[0].heat, 10);
    harness.dispose();
  });

  it("resumes from exactly where it was left", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setPhase("wave");
    harness.debug.addUnit("mote", "left");
    harness.debug.setScreen("paused");
    const paused = harness.debug.snapshot();
    await stepSeconds(harness, 1, 60);
    harness.debug.setScreen("playing");
    await stepSeconds(harness, 1, 60);
    const running = harness.debug.snapshot();
    expect(running.simTime).toBeCloseTo(paused.simTime + 1, 6);
    expect(running.surge[0].x).toBeGreaterThan(paused.surge[0].x);
    harness.dispose();
  });

  it("gains simulation time twice as fast at speed 2", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setSpeed(2);
    const before = harness.debug.snapshot().simTime;
    await stepSeconds(harness, 1.5, 90);
    expect(harness.debug.snapshot().simTime).toBeCloseTo(before + 3, 6);
    harness.dispose();
  });

  it("reaches the same state from the same game time at either speed", async () => {
    const readHeat = async (speed: number): Promise<number> => {
      const harness = await createHarness();
      startRun(harness);
      const id = poseTower(harness, "arc", 20, 12, 0);
      harness.debug.setTowerHeat(id, 80);
      harness.debug.setSpeed(speed);
      await stepSeconds(harness, 3 / speed, 180);
      const heat = harness.debug.snapshot().towers[0].heat;
      harness.dispose();
      return heat;
    };
    expect(await readHeat(2)).toBeCloseTo(await readHeat(1), 6);
  });

  it("toggles the speed on its key and on the panel's control", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setScreen("playing");
    harness.tap("KeyF");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().speed).toBe(2);
    const control = harness.debug.snapshot().controls.speed;
    await harness.press(control.x + control.w / 2, control.y + control.h / 2);
    expect(harness.debug.snapshot().speed).toBe(1);
    harness.dispose();
  });
});

describe("the wave spawner", () => {
  it("releases the wave's units at the stated cadence and no faster", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setWaveSpawning(true);
    harness.debug.setPhase("opening");
    harness.tap("Space");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().surge).toHaveLength(1);
    await stepSeconds(harness, WAVE_SPAWN_INTERVAL * 3, 180);
    expect(harness.debug.snapshot().surge).toHaveLength(4);
    harness.dispose();
  });

  it("costs nothing to place a tower during a wave beyond its cost", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setPhase("wave");
    harness.debug.setMoney(100);
    harness.debug.setArmed("arc");
    harness.debug.setPreview(30, 20);
    harness.debug.place();
    expect(harness.debug.snapshot().money).toBe(100 - TOWER_DEFS.arc.cost);
    harness.dispose();
  });
});
