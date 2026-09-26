// The seven screens, the run's beats, and the reset the debug surface rests on.

import { describe, expect, it } from "vitest";
import {
  DIVE_FIRST_DELAY,
  GAME_OVER_ITEMS,
  PAUSE_ITEMS,
  READY_HOLD,
  SCORE_PERFECT_BONUS,
  SCORE_STAGE_CLEAR,
  STAGE_CLEARED_HOLD,
  STAGE_INTRO_HOLD,
  START_LIVES,
  TITLE_ITEMS,
  CHALLENGE_TOTAL,
} from "./constants";
import { newFrameEvents } from "./events";
import {
  clearStage,
  endReadyHold,
  loseLife,
  menuLength,
  openNextStage,
  openWave,
  resetToTitle,
  startRun,
} from "./flow";
import { LANE_CENTER } from "./ship";
import { SpectraState } from "./game";
import { liveWave, poseDrone, posePlayerBullet } from "./fixtures";

describe("the menus", () => {
  it("counts the items of the three screens that have one, and no others", () => {
    expect(menuLength("title")).toBe(TITLE_ITEMS.length);
    expect(menuLength("paused")).toBe(PAUSE_ITEMS.length);
    expect(menuLength("gameOver")).toBe(GAME_OVER_ITEMS.length);
    expect(menuLength("inWave")).toBe(0);
    expect(menuLength("howto")).toBe(0);
    expect(menuLength("stageIntro")).toBe(0);
    expect(menuLength("stageCleared")).toBe(0);
  });
});

describe("the reset", () => {
  it("writes every declared field back to its title-screen value", () => {
    const state = liveWave();
    state.score = 4200;
    state.lives = 1;
    state.stage = 6;
    state.resonance = 90;
    state.inversion = 3;
    state.extraLifeAwarded = true;
    state.challengeHits = 7;
    state.menuIndex = 1;
    state.phaseTimer = 2;
    state.simTime = 40;
    state.discharge = { active: true, radius: 300 };
    state.ship.band = "magenta";
    state.ship.x = 100;
    state.ship.lockout = 0.2;
    state.ship.cooldown = 0.1;
    poseDrone(state, "shard", 400, 200);
    posePlayerBullet(state, 400, 300, "cyan");

    resetToTitle(state);

    const fresh = new SpectraState();
    expect(state.screen).toBe(fresh.screen);
    expect(state.phase).toBe(fresh.phase);
    expect(state.phaseTimer).toBe(fresh.phaseTimer);
    expect(state.menuIndex).toBe(fresh.menuIndex);
    expect(state.score).toBe(fresh.score);
    expect(state.lives).toBe(START_LIVES);
    expect(state.stage).toBe(1);
    expect(state.extraLifeAwarded).toBe(false);
    expect(state.challengeHits).toBe(0);
    expect(state.resonance).toBe(0);
    expect(state.inversion).toBe(0);
    expect(state.ship).toEqual({
      x: LANE_CENTER,
      band: "cyan",
      lockout: 0,
      cooldown: 0,
      contact: true,
    });
    expect(state.discharge).toEqual({ active: false, radius: 0 });
    expect(state.drones).toEqual([]);
    expect(state.bullets).toEqual([]);
    expect(state.bursts).toEqual([]);
    expect(state.waveEntry).toBe(true);
    expect(state.diveLaunching).toBe(true);
    expect(state.entryClock).toBe(0);
    expect(state.swayClock).toBe(0);
    expect(state.diveClock).toBe(0);
    expect(state.diveTarget).toBe(DIVE_FIRST_DELAY);
    expect(state.nextId).toBe(1);
    expect(state.simTime).toBe(0);
  });

  it("turns the three world gates back on", () => {
    const state = liveWave();
    state.waveEntry = false;
    state.diveLaunching = false;
    state.ship.contact = false;
    resetToTitle(state);
    expect(state.waveEntry).toBe(true);
    expect(state.diveLaunching).toBe(true);
    expect(state.ship.contact).toBe(true);
  });

  it("leaves muting exactly as it stands", () => {
    const state = liveWave();
    state.muted = true;
    resetToTitle(state);
    expect(state.muted).toBe(true);
  });
});

describe("a run", () => {
  it("opens at stage 1 with full lives, no score, and the stage's intro", () => {
    const state = liveWave();
    state.score = 900;
    state.lives = 1;
    state.stage = 5;
    startRun(state);
    expect(state.screen).toBe("stageIntro");
    expect(state.phaseTimer).toBe(STAGE_INTRO_HOLD);
    expect(state.stage).toBe(1);
    expect(state.lives).toBe(START_LIVES);
    expect(state.score).toBe(0);
    expect(state.drones).toEqual([]);
  });

  it("builds the stage's wave as the intro gives way", () => {
    const state = liveWave();
    startRun(state);
    openWave(state);
    expect(state.screen).toBe("inWave");
    expect(state.phase).toBe("live");
    expect(state.drones.length).toBeGreaterThan(0);
  });

  it("opens the next stage's intro one stage higher", () => {
    const state = liveWave();
    state.stage = 2;
    poseDrone(state, "shard", 100, 100);
    openNextStage(state);
    expect(state.stage).toBe(3);
    expect(state.screen).toBe("stageIntro");
    expect(state.phaseTimer).toBe(STAGE_INTRO_HOLD);
    expect(state.drones).toEqual([]);
  });
});

describe("clearing a stage", () => {
  it("pays the clear bonus and opens the interstitial", () => {
    const state = liveWave();
    const events = newFrameEvents();
    clearStage(state, events);
    expect(state.score).toBe(SCORE_STAGE_CLEAR);
    expect(state.screen).toBe("stageCleared");
    expect(state.phaseTimer).toBe(STAGE_CLEARED_HOLD);
    expect([...events.cues]).toContain("stage-clear");
  });

  it("pays a challenge stage its perfect bonus alone, and only when perfect", () => {
    const perfect = liveWave();
    perfect.stage = 3;
    perfect.challengeHits = CHALLENGE_TOTAL;
    clearStage(perfect, newFrameEvents());
    expect(perfect.score).toBe(SCORE_PERFECT_BONUS);

    const missed = liveWave();
    missed.stage = 3;
    missed.challengeHits = CHALLENGE_TOTAL - 1;
    clearStage(missed, newFrameEvents());
    expect(missed.score).toBe(0);
  });
});

describe("losing a life", () => {
  it("opens the ready hold with lives to spare, and carries the wave on", () => {
    const state = liveWave();
    const drone = poseDrone(state, "shard", 300, 250);
    drone.phase = "diving";
    const events = newFrameEvents();
    loseLife(state, events);
    expect(state.lives).toBe(START_LIVES - 1);
    expect(state.phase).toBe("ready");
    expect(state.phaseTimer).toBe(READY_HOLD);
    expect(state.screen).toBe("inWave");
    expect(state.drones[0]?.phase).toBe("diving");
    expect([...events.cues]).toContain("hit");
  });

  it("ends the run with no life left", () => {
    const state = liveWave();
    state.lives = 1;
    loseLife(state, newFrameEvents());
    expect(state.lives).toBe(0);
    expect(state.screen).toBe("gameOver");
    expect(state.menuIndex).toBe(0);
  });

  it("leaves the meter exactly where it stands", () => {
    const state = liveWave();
    state.resonance = 42;
    loseLife(state, newFrameEvents());
    expect(state.resonance).toBe(42);
  });

  it("puts the ship back at the centre of its lane when the hold ends", () => {
    const state = liveWave();
    state.ship.x = 90;
    state.ship.band = "magenta";
    loseLife(state, newFrameEvents());
    endReadyHold(state);
    expect(state.phase).toBe("live");
    expect(state.ship.x).toBe(LANE_CENTER);
    expect(state.ship.band).toBe("magenta");
  });
});
