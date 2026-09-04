// One frame of the run, and the run the frames add up to (specs/waves.md,
// specs/economy.md, specs/surge.md).
//
// Every scenario here drives `stepSimulation` directly with a game time it
// chose, which is what the spec's "an interval of game time reaches the same
// state however it was divided into frames" allows: no browser, no canvas, and
// no wall clock takes part in any answer below.

import { describe, expect, it } from "vitest";
import {
  BUILD_PHASE_TIME,
  EARLY_SEND_PER_SECOND,
  INTEREST_CAP,
  INTEREST_RATE,
  SCORE_VICTORY_PER_LIFE,
  SCORE_WAVE_CLEAR,
  TILE,
  WAVE_CLEAR_BASE,
  WAVE_CLEAR_PER_WAVE,
  WAVE_SPAWN_INTERVAL,
  hpScale,
  tileCX,
  tileCY,
} from "./constants";
import { NO_CUES, addTower } from "./build";
import { SURGE_DEFS } from "./defs";
import { modeFigures } from "./modes";
import {
  addUnit,
  clearSurge,
  removeUnit,
  send,
  startWave,
  stepSimulation,
} from "./sim";
import { createState, startRun, type MeltdownState } from "./state";
import { exhaustPoint, remainingOf } from "./units";
import { releaseCount, waveSize, waveType } from "./waves";
import type { DifficultyId, ModeId } from "./types";

/** A run in progress, on a chosen mode and difficulty, in its opening phase. */
function running(
  mode: ModeId = "containment",
  difficulty: DifficultyId = "medium",
): MeltdownState {
  const state = createState();
  state.mode = mode;
  state.difficulty = difficulty;
  startRun(state);
  return state;
}

/** Every cue the frames of one scenario raised, in order. */
function recorder(): { cues: string[]; sink: (cue: string) => void } {
  const cues: string[] = [];
  return { cues, sink: (cue) => cues.push(cue) };
}

/** Run `seconds` of game time as `frames` equal frames. */
function run(
  state: MeltdownState,
  seconds: number,
  frames = 1,
  cue = NO_CUES,
): void {
  const step = seconds / frames;
  for (let i = 0; i < frames; i += 1) stepSimulation(state, step, cue);
}

describe("the three phases", () => {
  it("opens untimed, on wave one, and starts no wave of its own", () => {
    const state = running();
    expect(state.phase).toBe("opening");
    expect(state.wave).toBe(1);
    expect(state.buildTimer).toBe(0);
    run(state, 60, 60);
    expect(state.phase).toBe("opening");
    expect(state.surge).toHaveLength(0);
  });

  it("counts a build phase down one second per second and then releases", () => {
    const state = running();
    state.phase = "building";
    state.buildTimer = 2;
    run(state, 1, 10);
    expect(state.buildTimer).toBeCloseTo(1, 6);
    expect(state.phase).toBe("building");
    run(state, 1.001, 10);
    expect(state.phase).toBe("wave");
  });

  it("holds the phase where it stands with the world gate off", () => {
    const state = running();
    state.phase = "building";
    state.buildTimer = 1;
    state.waveSpawning = false;
    run(state, 2, 20);
    expect(state.buildTimer).toBe(0);
    expect(state.phase).toBe("building");
    expect(state.surge).toHaveLength(0);
  });
});

describe("the release", () => {
  it("releases the first unit on the frame the wave begins", () => {
    const state = running();
    startWave(state);
    expect(state.phase).toBe("wave");
    expect(state.surge).toHaveLength(1);
    expect(state.wavePending).toBe(waveSize(1, 20) - 1);
  });

  it("releases one unit every spawn interval and no faster", () => {
    const state = running();
    startWave(state);
    run(state, WAVE_SPAWN_INTERVAL * 0.9, 9);
    expect(state.surge).toHaveLength(1);
    run(state, WAVE_SPAWN_INTERVAL * 0.2, 2);
    expect(state.surge).toHaveLength(2);
    run(state, WAVE_SPAWN_INTERVAL * 3, 30);
    expect(state.surge).toHaveLength(5);
  });

  it("counts the whole wave onto wavePending and releases no more", () => {
    const state = running();
    state.wave = 3;
    startWave(state);
    const total = waveSize(3, 20);
    // Counted as they appear rather than off the roster at the end, because a
    // unit released early has crossed the floor and left by then.
    const released = new Set<number>();
    const types = new Set<string>();
    for (let frame = 0; frame < (total + 5) * 4; frame += 1) {
      stepSimulation(state, WAVE_SPAWN_INTERVAL / 4, NO_CUES);
      for (const unit of state.surge) {
        released.add(unit.id);
        types.add(unit.type);
      }
    }
    expect(state.wavePending).toBe(0);
    expect(released.size).toBe(total);
    expect([...types]).toEqual([waveType(3, 20)]);
  });

  it("releases nothing at all with the world gate off", () => {
    const state = running();
    state.waveSpawning = false;
    startWave(state);
    expect(state.wavePending).toBe(waveSize(1, 20));
    run(state, 10, 100);
    expect(state.surge).toHaveLength(0);
  });

  it("draws every vent from the seeded generator, so a seed replays", () => {
    const first = createState(7);
    first.mode = "containment";
    startRun(first);
    startWave(first);
    run(first, WAVE_SPAWN_INTERVAL * 8, 80);
    const second = createState(7);
    second.mode = "containment";
    startRun(second);
    startWave(second);
    run(second, WAVE_SPAWN_INTERVAL * 8, 80);
    expect(second.surge.map((unit) => unit.vent)).toEqual(
      first.surge.map((unit) => unit.vent),
    );
    expect(new Set(first.surge.map((unit) => unit.vent)).size).toBe(2);
  });

  it("leaves the generator alone when the gate held the release back", () => {
    const state = running();
    state.waveSpawning = false;
    startWave(state);
    const before = state.rng.seed;
    run(state, 10, 100);
    expect(state.rng.seed).toBe(before);
  });

  it("scales every released unit's hp for the wave it belongs to", () => {
    const state = running();
    state.wave = 5;
    startWave(state);
    const unit = state.surge[0];
    expect(unit.maxHp).toBeCloseTo(SURGE_DEFS[unit.type].hp * hpScale(5), 6);
    expect(unit.hp).toBe(unit.maxHp);
  });

  it("gives The Hundred one onslaught of a hundred mixed units", () => {
    const state = running("hundred");
    startWave(state);
    expect(releaseCount("hundred", 1, 1)).toBe(100);
    run(state, WAVE_SPAWN_INTERVAL * 6, 60);
    expect(state.surge.map((unit) => unit.type).slice(0, 5)).toEqual([
      "mote",
      "sprint",
      "swarm",
      "drift",
      "hulk",
    ]);
    expect(state.surge[0].maxHp).toBe(SURGE_DEFS.mote.hp * 6);
  });
});

describe("movement", () => {
  it("walks a unit toward its exhaust at its own speed", () => {
    const state = running();
    const unit = addUnit(state, "mote", "left");
    const before = remainingOf(unit, state.floor);
    run(state, 1, 60);
    expect(remainingOf(unit, state.floor)).toBeLessThan(before);
    expect(unit.x).toBeGreaterThan(tileCX(0));
  });

  it("reaches the same place however the second was divided", () => {
    const coarse = running();
    const fine = running();
    const a = addUnit(coarse, "mote", "left");
    const b = addUnit(fine, "mote", "left");
    run(coarse, 1, 2);
    run(fine, 1, 120);
    expect(a.x).toBeCloseTo(b.x, 3);
    expect(a.y).toBeCloseTo(b.y, 3);
  });

  it("holds a unit still with its motion gate off, route and all", () => {
    const state = running();
    const unit = addUnit(state, "mote", "left");
    unit.motion = false;
    const at = { x: unit.x, y: unit.y };
    const before = remainingOf(unit, state.floor);
    run(state, 2, 40);
    expect(unit.x).toBe(at.x);
    expect(unit.y).toBe(at.y);
    addTower(state, "lance", 1, 14, 0);
    expect(remainingOf(unit, state.floor)).toBeGreaterThan(before);
  });

  it("flies the Drift straight at its exhaust's opening, ignoring the maze", () => {
    const walled = running();
    const open = running();
    for (let row = 0; row < 34; row += 2) addTower(walled, "arc", 20, row, 0);
    const flyer = addUnit(walled, "drift", "left");
    const clear = addUnit(open, "drift", "left");
    run(walled, 1, 60);
    run(open, 1, 60);
    expect(flyer.x).toBeCloseTo(clear.x, 6);
    expect(flyer.y).toBeCloseTo(clear.y, 6);
    const goal = exhaustPoint("right");
    expect(remainingOf(flyer, walled.floor)).toBeCloseTo(
      Math.hypot(goal.x - flyer.x, goal.y - flyer.y) / TILE,
      6,
    );
  });

  it("slows a unit to exactly the fraction its slow leaves it", () => {
    const fast = running();
    const slow = running();
    const a = addUnit(fast, "mote", "left");
    const b = addUnit(slow, "mote", "left");
    b.slowFactor = 0.5;
    b.slowTimer = 10;
    run(fast, 0.5, 30);
    run(slow, 0.5, 30);
    expect(b.x - tileCX(0)).toBeCloseTo((a.x - tileCX(0)) / 2, 3);
  });

  it("ends a slow when its timer runs out and returns the base speed", () => {
    const state = running();
    const unit = addUnit(state, "mote", "left");
    unit.slowFactor = 0.5;
    unit.slowTimer = 0.5;
    run(state, 0.6, 6);
    expect(unit.slowFactor).toBe(0);
    expect(unit.slowTimer).toBe(0);
  });
});

describe("leaks", () => {
  it("removes the unit and takes its leak value in lives", () => {
    const state = running();
    const cue = recorder();
    const unit = addUnit(state, "hulk", "left");
    unit.x = exhaustPoint("right").x;
    unit.y = exhaustPoint("right").y;
    const lives = state.lives;
    run(state, 1 / 60, 1, cue.sink);
    expect(state.surge).toHaveLength(0);
    expect(state.lives).toBe(lives - SURGE_DEFS.hulk.leak);
    expect(cue.cues).toContain("leak");
    expect(state.money).toBe(modeFigures("containment", "medium").startMoney);
  });

  it("ends the run on the frame the last life goes, whatever the phase", () => {
    const state = running("suddendeath");
    const cue = recorder();
    expect(state.lives).toBe(1);
    const unit = addUnit(state, "mote", "left");
    unit.x = exhaustPoint("right").x;
    unit.y = exhaustPoint("right").y;
    run(state, 1 / 60, 1, cue.sink);
    expect(state.lives).toBe(0);
    expect(state.screen).toBe("gameover");
    expect(state.menuIndex).toBe(0);
    expect(cue.cues).toContain("game-over");
  });
});

describe("the economy", () => {
  it("pays a bounty and the same figure in score for a kill", () => {
    const state = running();
    const cue = recorder();
    state.phase = "wave";
    // One unit still to release, so the kill below does not also clear the wave
    // and pay its bonus on top of the bounty.
    state.wavePending = 1;
    state.waveSpawning = false;
    const tower = addTower(state, "lance", 8, 16, 0);
    tower.heat = 92;
    const unit = addUnit(state, "mote", "left");
    unit.x = tileCX(10);
    unit.y = tileCY(17);
    unit.hp = 1;
    const money = state.money;
    run(state, 2, 20, cue.sink);
    expect(state.surge).toHaveLength(0);
    expect(state.money).toBe(money + SURGE_DEFS.mote.bounty);
    expect(state.score).toBe(SURGE_DEFS.mote.bounty);
    expect(tower.kills).toBe(1);
    expect(cue.cues).toContain("death");
  });

  it("pays the wave-clear bonus and its score, then the interest on it", () => {
    const state = running();
    const cue = recorder();
    state.phase = "wave";
    state.wave = 4;
    state.wavePending = 0;
    state.money = 100;
    const unit = addUnit(state, "mote", "left");
    unit.x = exhaustPoint("right").x;
    unit.y = exhaustPoint("right").y;
    run(state, 1 / 60, 1, cue.sink);
    const cleared = 100 + WAVE_CLEAR_BASE + WAVE_CLEAR_PER_WAVE * 4;
    const interest = Math.min(
      Math.floor(INTEREST_RATE * cleared),
      INTEREST_CAP,
    );
    expect(state.money).toBe(cleared + interest);
    expect(state.score).toBe(SCORE_WAVE_CLEAR * 4);
    expect(state.wave).toBe(5);
    expect(state.phase).toBe("building");
    expect(state.buildTimer).toBe(BUILD_PHASE_TIME);
    expect(cue.cues).toContain("wave-clear");
  });

  it("caps the interest and pays none on a mode that pays none", () => {
    const state = running("deeppockets");
    state.phase = "wave";
    state.wave = 2;
    state.wavePending = 0;
    state.money = 10000;
    const unit = addUnit(state, "mote", "left");
    unit.x = exhaustPoint("right").x;
    unit.y = exhaustPoint("right").y;
    run(state, 1 / 60);
    expect(state.money).toBe(10000 + WAVE_CLEAR_BASE + WAVE_CLEAR_PER_WAVE * 2);

    const paid = running("bottleneck");
    paid.phase = "wave";
    paid.wave = 2;
    paid.wavePending = 0;
    paid.money = 10000;
    const leaker = addUnit(paid, "mote", "left");
    leaker.x = exhaustPoint("right").x;
    leaker.y = exhaustPoint("right").y;
    run(paid, 1 / 60);
    expect(paid.money).toBe(
      10000 + WAVE_CLEAR_BASE + WAVE_CLEAR_PER_WAVE * 2 + INTEREST_CAP,
    );
  });

  it("pays one per whole second left on an early send, and none from the opening", () => {
    const timed = running();
    timed.phase = "building";
    timed.buildTimer = 7.8;
    const money = timed.money;
    send(timed);
    expect(timed.money).toBe(money + EARLY_SEND_PER_SECOND * 7);
    expect(timed.phase).toBe("wave");

    const opening = running();
    const before = opening.money;
    send(opening);
    expect(opening.money).toBe(before);
    expect(opening.phase).toBe("wave");
  });

  it("refuses a send while a wave is already on the floor", () => {
    const state = running();
    startWave(state);
    const pending = state.wavePending;
    send(state);
    expect(state.wavePending).toBe(pending);
  });
});

describe("clearing a run", () => {
  it("clears on the frame the last unit falls with nothing left to release", () => {
    const state = running();
    state.phase = "wave";
    state.wave = 2;
    state.wavePending = 1;
    const unit = addUnit(state, "mote", "left");
    unit.x = exhaustPoint("right").x;
    unit.y = exhaustPoint("right").y;
    run(state, 1 / 60);
    expect(state.phase).toBe("wave");
    expect(state.wave).toBe(2);
  });

  it("never clears a phase that released nothing", () => {
    const state = running();
    state.phase = "wave";
    state.wavePending = 0;
    state.waveSpawning = false;
    run(state, 5, 50);
    expect(state.phase).toBe("wave");
    expect(state.wave).toBe(1);
  });

  it("ends in victory on the last wave, paying for every life left", () => {
    const state = running("hundred");
    const cue = recorder();
    state.phase = "wave";
    state.wavePending = 0;
    state.lives = 12;
    const unit = addUnit(state, "mote", "left");
    unit.x = exhaustPoint("right").x;
    unit.y = exhaustPoint("right").y;
    run(state, 1 / 60, 1, cue.sink);
    expect(state.screen).toBe("victory");
    expect(state.menuIndex).toBe(0);
    expect(state.score).toBe(
      SCORE_WAVE_CLEAR * 1 + SCORE_VICTORY_PER_LIFE * (12 - 1),
    );
    expect(cue.cues).toContain("victory");
  });

  it("loses rather than wins when the final leak takes the last life", () => {
    const state = running("suddendeath");
    state.wave = 20;
    state.phase = "wave";
    state.wavePending = 0;
    const unit = addUnit(state, "mote", "left");
    unit.x = exhaustPoint("right").x;
    unit.y = exhaustPoint("right").y;
    run(state, 1 / 60);
    expect(state.screen).toBe("gameover");
  });
});

describe("the surge atoms", () => {
  it("appends an added unit, so its id is read off the end", () => {
    const state = running();
    const first = addUnit(state, "mote", "left");
    const second = addUnit(state, "hulk", "top");
    expect(state.surge[state.surge.length - 1]).toBe(second);
    expect(second.id).toBeGreaterThan(first.id);
    expect(second.vent).toBe("top");
  });

  it("removes one unit at no cost to lives, money or score", () => {
    const state = running();
    const unit = addUnit(state, "core", "left");
    const before = { ...state };
    removeUnit(state, unit.id);
    expect(state.surge).toHaveLength(0);
    expect(state.lives).toBe(before.lives);
    expect(state.money).toBe(before.money);
    expect(state.score).toBe(before.score);
  });

  it("clears the surge and leaves the towers exactly as they stand", () => {
    const state = running();
    const tower = addTower(state, "arc", 20, 20, 0);
    tower.heat = 44;
    tower.kills = 3;
    addUnit(state, "mote", "left");
    addUnit(state, "mote", "top");
    clearSurge(state);
    expect(state.surge).toHaveLength(0);
    expect(state.towers).toHaveLength(1);
    expect(tower.heat).toBe(44);
    expect(tower.kills).toBe(3);
  });
});

describe("freshness", () => {
  it("loses freshness on the frame the phase becomes a wave", () => {
    const state = running();
    const tower = addTower(state, "arc", 20, 20, 0);
    expect(tower.fresh).toBe(true);
    startWave(state);
    expect(tower.fresh).toBe(false);
  });
});
