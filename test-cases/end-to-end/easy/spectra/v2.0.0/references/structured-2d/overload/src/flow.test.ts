import { describe, expect, it } from "vitest";
import {
  CHALLENGE_TOTAL,
  DIVE_FIRST_DELAY,
  READY_HOLD,
  SCORE_STAGE_CLEAR,
  STAGE_CLEARED_HOLD,
  STAGE_INTRO_HOLD,
  START_LIVES,
} from "./constants";
import { addEnemyBulletTo, addPlayerBulletTo } from "./bullets";
import { noCues } from "./audio";
import { LANE_CENTER } from "./ship";
import {
  advanceStage,
  enterStageIntro,
  loseLife,
  resetState,
  startRun,
  toTitle,
} from "./flow";
import { liveState, poseDrone, run, runUntil, titleState } from "./fixtures";

describe("reset", () => {
  it("restores every declared field to its title value", () => {
    const state = liveState();
    state.screen = "gameOver";
    state.phase = "ready";
    state.phaseTimer = 3;
    state.menuIndex = 2;
    state.score = 9000;
    state.lives = 1;
    state.stage = 7;
    state.extraLifeAwarded = true;
    state.challengeHits = 12;
    state.resonance = 40;
    state.inversion = 2;
    state.muted = true;
    state.ship.x = 100;
    state.ship.band = "magenta";
    state.ship.lockout = 0.2;
    state.ship.cooldown = 0.1;
    state.ship.contact = false;
    state.simTime = 44;
    state.diveClock = 1.2;
    poseDrone(state, "shard", 300, 200);
    addPlayerBulletTo(state, 300, 400, "cyan");

    resetState(state);

    expect(state).toMatchObject({
      screen: "title",
      phase: "live",
      phaseTimer: 0,
      menuIndex: 0,
      score: 0,
      lives: START_LIVES,
      stage: 1,
      extraLifeAwarded: false,
      challengeHits: 0,
      resonance: 0,
      inversion: 0,
      waveEntry: true,
      diveLaunching: true,
      diveClock: 0,
      diveTarget: DIVE_FIRST_DELAY,
      simTime: 0,
      // Muting is a player preference the runtime owns, so it is left alone.
      muted: true,
    });
    expect(state.drones).toHaveLength(0);
    expect(state.bullets).toHaveLength(0);
    expect(state.bursts).toHaveLength(0);
    expect(state.discharge).toEqual({ active: false, radius: 0 });
    expect(state.ship).toEqual({
      x: LANE_CENTER,
      band: "cyan",
      lockout: 0,
      cooldown: 0,
      contact: true,
    });
  });
});

describe("the screens a run moves through", () => {
  it("opens a run at stage one with its lives and no score", () => {
    const state = titleState();
    state.score = 500;
    state.lives = 1;
    state.stage = 6;
    startRun(state);
    expect(state).toMatchObject({
      screen: "stageIntro",
      stage: 1,
      lives: START_LIVES,
      score: 0,
      phaseTimer: STAGE_INTRO_HOLD,
    });
    expect(state.drones).toHaveLength(0);
  });

  it("gives way from the intro to the live wave, building it there", () => {
    const state = titleState();
    startRun(state);
    run(state, STAGE_INTRO_HOLD - 0.2);
    expect(state.screen).toBe("stageIntro");
    expect(state.drones).toHaveLength(0);
    run(state, 0.3);
    expect(state.screen).toBe("inWave");
    expect(state.drones.length).toBeGreaterThan(0);
  });

  it("clears a stage on the moment its last drone is destroyed", () => {
    const state = liveState();
    poseDrone(state, "shard", 400, 200);
    addPlayerBulletTo(state, 400, 200, "cyan");
    expect(state.screen).toBe("inWave");
    // The clear happens in the sub-step the last drone is removed in.
    run(state, 1 / 60);
    expect(state.drones).toHaveLength(0);
    expect(state.screen).toBe("stageCleared");
    expect(state.score).toBeGreaterThanOrEqual(SCORE_STAGE_CLEAR);
  });

  it("plays on rather than clearing when a wave never held a drone", () => {
    const state = liveState();
    run(state, 10);
    expect(state.screen).toBe("inWave");
  });

  it("gives way from the interstitial to the next stage's intro", () => {
    const state = liveState();
    state.screen = "stageCleared";
    state.phaseTimer = STAGE_CLEARED_HOLD;
    run(state, STAGE_CLEARED_HOLD + 0.1);
    expect(state.screen).toBe("stageIntro");
    expect(state.stage).toBe(2);
  });

  it("ends a challenge stage once its groups have gone", () => {
    const state = liveState();
    state.stage = 3;
    state.waveEntry = true;
    enterStageIntro(state);
    const { held } = runUntil(state, () => state.screen === "stageCleared", 20);
    expect(held).toBe(true);
    expect(state.challengeHits).toBeLessThan(CHALLENGE_TOTAL);
  });

  it("freezes the field on the paused screen", () => {
    const state = liveState();
    const drone = poseDrone(state, "shard", 400, 200, {
      slotX: 400,
      slotY: 200,
      phase: "diving",
      travel: true,
    });
    const bullet = addPlayerBulletTo(state, 500, 400, "cyan");
    state.screen = "paused";
    const before = `${drone.x},${drone.y},${bullet.y},${state.swayClock}`;
    run(state, 10);
    expect(`${drone.x},${drone.y},${bullet.y},${state.swayClock}`).toBe(before);
  });

  it("advances a stage by one and opens its intro", () => {
    const state = liveState();
    state.stage = 4;
    advanceStage(state);
    expect(state.stage).toBe(5);
    expect(state.screen).toBe("stageIntro");
  });

  it("returns to the title with its highlight at the first item", () => {
    const state = liveState();
    state.menuIndex = 2;
    toTitle(state);
    expect(state.screen).toBe("title");
    expect(state.menuIndex).toBe(0);
  });
});

describe("losing a life", () => {
  it("enters the ready beat and returns to live play", () => {
    const state = liveState();
    loseLife(state, noCues());
    expect(state.lives).toBe(START_LIVES - 1);
    expect(state.phase).toBe("ready");
    expect(state.phaseTimer).toBeCloseTo(READY_HOLD, 6);
    run(state, READY_HOLD - 0.1);
    expect(state.phase).toBe("ready");
    run(state, 0.2);
    expect(state.phase).toBe("live");
    expect(state.ship.x).toBe(LANE_CENTER);
  });

  it("leaves the wave exactly where it was", () => {
    const state = liveState();
    const drone = poseDrone(state, "shard", 400, 200, { phase: "formation" });
    loseLife(state, noCues());
    run(state, READY_HOLD + 0.2);
    expect(state.drones).toContain(drone);
    expect(drone.phase).toBe("formation");
    expect(drone.x).toBe(400);
  });

  it("leaves the meter exactly where it stands", () => {
    const state = liveState();
    state.resonance = 42;
    loseLife(state, noCues());
    expect(state.resonance).toBe(42);
  });

  it("ends the run when the last life goes", () => {
    const state = liveState();
    state.lives = 1;
    loseLife(state, noCues());
    expect(state.lives).toBe(0);
    expect(state.screen).toBe("gameOver");
  });

  it("costs nothing further through the hold", () => {
    const state = liveState();
    state.ship.contact = true;
    loseLife(state, noCues());
    addEnemyBulletTo(state, state.ship.x, 600, "magenta");
    run(state, 0.2);
    expect(state.lives).toBe(START_LIVES - 1);
  });
});
