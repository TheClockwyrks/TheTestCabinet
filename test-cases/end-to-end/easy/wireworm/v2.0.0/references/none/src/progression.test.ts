// Wireworm — the run: lives, the respawn, the twelve levels, and scoring
// (specs/progression.md, specs/scoring.md).

import { describe, expect, test } from "vitest";
import {
  BANNER_TIME,
  BONUS_LIFE_EVERY,
  CUES,
  RESPAWN_INVULN,
  RESPAWN_TIME,
  SCORE_LEVEL_CLEAR,
  SCORE_VICTORY,
  START_LIVES,
  TOTAL_LEVELS,
  wormLength,
} from "./constants";
import { chargeAt, listNodes, setCharge } from "./field";
import { createInitialState } from "./game";
import {
  BAND_CENTER_X,
  BAND_CENTER_Y,
  advancePhase,
  checkLevelCleared,
  enterLevelWorm,
  levelClear,
  loseLife,
  startRun,
  toTitle,
} from "./progression";
import { addScore, poseScore } from "./scoring";
import {
  CueLog,
  layWorm,
  posedState,
  run,
  stubApi,
} from "./harness.test-support";
import { makeFoe } from "./foes";

describe("starting a run", () => {
  test("a new run opens on the level-1 banner with three lives and no score", () => {
    const state = createInitialState();
    startRun(state);
    expect(state.screen).toBe("playing");
    expect(state.phase).toBe("banner");
    expect(state.phaseTimer).toBeCloseTo(BANNER_TIME, 10);
    expect(state.lives).toBe(START_LIVES);
    expect(state.level).toBe(1);
    expect(state.reachedLevel).toBe(1);
    expect(state.score).toBe(0);
    expect(listNodes(state.field).length).toBeGreaterThan(0);
    expect([state.cursor.x, state.cursor.y]).toEqual([
      BAND_CENTER_X,
      BAND_CENTER_Y,
    ]);
  });

  test("it leaves the world gates exactly as it found them", () => {
    const state = createInitialState();
    state.foeSpawning = false;
    state.wormEntry = false;
    state.cursor.contact = false;
    startRun(state);
    expect(state.foeSpawning).toBe(false);
    expect(state.wormEntry).toBe(false);
    expect(state.cursor.contact).toBe(false);
  });

  test("the title's highlight rests on the first item", () => {
    const state = createInitialState();
    state.menuIndex = 2;
    toTitle(state);
    expect(state.screen).toBe("title");
    expect(state.menuIndex).toBe(0);
  });
});

describe("the phases", () => {
  test("the banner gives way to live play, bringing in the level's worm", () => {
    const state = posedState(3);
    state.wormEntry = true;
    state.phase = "banner";
    state.phaseTimer = BANNER_TIME;
    expect(advancePhase(state, BANNER_TIME / 2)).toBe(false);
    expect(state.worms).toEqual([]);
    expect(advancePhase(state, BANNER_TIME / 2)).toBe(false);
    expect(state.phase).toBe("active");
    expect(state.worms).toHaveLength(1);
    expect(state.worms[0].segments).toHaveLength(wormLength(3));
  });

  test("the worm enters along the entry row, heading inward and down", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const state = posedState(1);
      state.wormEntry = true;
      state.rngState = seed;
      enterLevelWorm(state);
      const worm = state.worms[0];
      expect(worm.segments.every((segment) => segment.r === 0)).toBe(true);
      expect(worm.dv).toBe(1);
      const head = worm.segments[0];
      const tail = worm.segments[worm.segments.length - 1];
      // The head is the further from the edge the worm entered at.
      if (worm.dh === 1) expect(head.c).toBeGreaterThan(tail.c);
      else expect(head.c).toBeLessThan(tail.c);
      expect(
        worm.segments.every((segment) => segment.c >= 0 && segment.c < 40),
      ).toBe(true);
    }
  });

  test("worm entry off keeps the level's worm away", () => {
    const state = posedState(1);
    state.wormEntry = false;
    state.phase = "banner";
    state.phaseTimer = BANNER_TIME;
    advancePhase(state, BANNER_TIME);
    expect(state.phase).toBe("active");
    expect(state.worms).toEqual([]);
  });

  test("live play reports itself and runs no timer", () => {
    const state = posedState();
    expect(advancePhase(state, 0.5)).toBe(true);
    expect(state.phase).toBe("active");
  });
});

describe("losing a life", () => {
  test("a contact with lives to spare costs one and opens the respawn", () => {
    const state = posedState();
    setCharge(state.field, 5, 5, 2);
    layWorm(state, [[5, 6]]);
    state.foes.push(makeFoe(state, "glitch", 100, 300));
    state.bolts.push({ id: 99, x: 100, y: 300 });
    const cues = new CueLog();
    loseLife(state, cues);
    expect(state.lives).toBe(START_LIVES - 1);
    expect(state.phase).toBe("respawn");
    expect(state.phaseTimer).toBeCloseTo(RESPAWN_TIME, 10);
    expect(state.worms).toEqual([]);
    expect(state.foes).toEqual([]);
    expect(state.bolts).toEqual([]);
    // The node field stands exactly as it was.
    expect(chargeAt(state.field, 5, 5)).toBe(2);
    expect(cues.count(CUES.life)).toBe(1);
  });

  test("the respawn gives way to play, invulnerable, with a fresh worm", () => {
    const state = posedState(2);
    state.wormEntry = true;
    state.phase = "respawn";
    state.phaseTimer = RESPAWN_TIME;
    advancePhase(state, RESPAWN_TIME);
    expect(state.phase).toBe("active");
    expect(state.cursor.invulnerable).toBeCloseTo(RESPAWN_INVULN, 10);
    expect(state.worms[0].segments).toHaveLength(wormLength(2));
  });

  test("the invulnerability counts down against the delta and rests at zero", () => {
    const state = posedState();
    const cues = new CueLog();
    const api = stubApi(cues);
    state.cursor.invulnerable = RESPAWN_INVULN;
    run(state, api, cues, 0.5, 30);
    expect(state.cursor.invulnerable).toBeCloseTo(RESPAWN_INVULN - 0.5, 6);
    run(state, api, cues, 5, 60);
    expect(state.cursor.invulnerable).toBe(0);
  });

  test("a contact that takes lives to zero ends the run", () => {
    const state = posedState(7);
    state.lives = 1;
    const cues = new CueLog();
    loseLife(state, cues);
    expect(state.lives).toBe(0);
    expect(state.screen).toBe("gameover");
    expect(state.reachedLevel).toBe(7);
    expect(cues.count(CUES.gameOver)).toBe(1);
  });

  test("a run that has already ended cannot lose another life", () => {
    const state = posedState();
    state.lives = 1;
    const cues = new CueLog();
    loseLife(state, cues);
    loseLife(state, cues);
    expect(state.lives).toBe(0);
    expect(cues.count(CUES.life)).toBe(1);
  });
});

describe("clearing a level", () => {
  test("a clear pays the bonus, advances the level, and opens the banner", () => {
    const state = posedState(4);
    setCharge(state.field, 5, 5, 2);
    state.foes.push(makeFoe(state, "glitch", 100, 300));
    state.bolts.push({ id: 99, x: 100, y: 300 });
    const cues = new CueLog();
    levelClear(state, cues);
    expect(state.score).toBe(SCORE_LEVEL_CLEAR * 4);
    expect(state.level).toBe(5);
    expect(state.reachedLevel).toBe(5);
    expect(state.phase).toBe("banner");
    expect(state.phaseTimer).toBeCloseTo(BANNER_TIME, 10);
    expect(state.foes).toEqual([]);
    expect(state.bolts).toEqual([]);
    // The field carries into the next level at the charges it held.
    expect(chargeAt(state.field, 5, 5)).toBe(2);
    expect(cues.count(CUES.levelClear)).toBe(1);
  });

  test("clearing the last level wins the run and pays the victory bonus", () => {
    const state = posedState(TOTAL_LEVELS);
    state.lives = 2;
    const cues = new CueLog();
    levelClear(state, cues);
    expect(state.screen).toBe("victory");
    expect(state.reachedLevel).toBe(TOTAL_LEVELS);
    expect(state.score).toBe(
      SCORE_LEVEL_CLEAR * TOTAL_LEVELS + SCORE_VICTORY * 2,
    );
    expect(cues.count(CUES.victory)).toBe(1);
  });

  test("a board that never held a worm is played rather than cleared", () => {
    const state = posedState(4);
    const cues = new CueLog();
    const api = stubApi(cues);
    // The clear is a TRANSITION: it is taken on the step a segment is removed,
    // and this board has had none removed, so seconds of play leave it standing.
    run(state, api, cues, 5, 300);
    expect(state.level).toBe(4);
    expect(state.phase).toBe("active");
    expect(state.screen).toBe("playing");
  });

  test("a removal on any screen but live play clears nothing", () => {
    const banner = posedState(4);
    banner.phase = "banner";
    checkLevelCleared(banner, new CueLog());
    expect(banner.level).toBe(4);

    const paused = posedState(4);
    paused.screen = "paused";
    checkLevelCleared(paused, new CueLog());
    expect(paused.level).toBe(4);

    // A worm still standing is not a clear either.
    const standing = posedState(4);
    layWorm(standing, [[5, 5]]);
    checkLevelCleared(standing, new CueLog());
    expect(standing.level).toBe(4);
  });
});

describe("the score", () => {
  test("a bonus life is granted at every multiple crossed", () => {
    const state = posedState();
    addScore(state, BONUS_LIFE_EVERY - 50);
    expect(state.lives).toBe(START_LIVES);
    addScore(state, 50);
    expect(state.lives).toBe(START_LIVES + 1);
  });

  test("one award crossing several multiples grants a life for each", () => {
    const state = posedState();
    addScore(state, BONUS_LIFE_EVERY * 3 + 5);
    expect(state.lives).toBe(START_LIVES + 3);
  });

  test("posing the score grants nothing and leaves the next award in place", () => {
    const state = posedState();
    poseScore(state, BONUS_LIFE_EVERY - 50);
    expect(state.lives).toBe(START_LIVES);
    poseScore(state, BONUS_LIFE_EVERY * 2 + 500);
    expect(state.lives).toBe(START_LIVES);
    // The next real award still lands at the next multiple.
    addScore(state, BONUS_LIFE_EVERY);
    expect(state.lives).toBe(START_LIVES + 1);
  });
});

describe("the simulation clock", () => {
  test("simulation time accumulates whatever the screen", () => {
    const state = createInitialState();
    const cues = new CueLog();
    const api = stubApi(cues);
    run(state, api, cues, 1, 60);
    expect(state.simTime).toBeCloseTo(1, 6);
    state.screen = "paused";
    run(state, api, cues, 1, 60);
    expect(state.simTime).toBeCloseTo(2, 6);
  });

  test("a paused game steps nothing", () => {
    const state = posedState();
    const worm = layWorm(state, [[5, 5]]);
    state.foes.push(makeFoe(state, "glitch", 300, 300));
    state.screen = "paused";
    const cues = new CueLog();
    const api = stubApi(cues);
    run(state, api, cues, 1, 60);
    expect(worm.segments[0]).toEqual({ c: 5, r: 5 });
    expect(state.foes[0].x).toBe(300);
    expect(cues.played).toEqual([]);
  });
});
