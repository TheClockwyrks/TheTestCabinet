import { describe, expect, it } from "vitest";
import { noCues } from "./audio";
import { addBoltTo } from "./bolts";
import {
  BANNER_TIME,
  BONUS_LIFE_EVERY,
  COLS,
  RESPAWN_INVULN,
  RESPAWN_TIME,
  SCATTER_BOTTOM_ROW,
  SCATTER_MAX_FRACTION,
  SCATTER_MIN_FRACTION,
  SCATTER_TOP_ROW,
  SCORE_LEVEL_CLEAR,
  SCORE_VICTORY,
  START_LIVES,
  TOTAL_LEVELS,
  tileCX,
  tileCY,
} from "./constants";
import { playingState, poseFoe, poseWorm } from "./fixtures";
import {
  BAND_CX,
  BAND_CY,
  clearLevel,
  loseLife,
  resetState,
  scatterField,
  startRun,
} from "./flow";
import { WirewormState } from "./game";
import { putNode } from "./grid";
import { addScore } from "./scoring";
import { advanceGame } from "./sim";

const FRAME = 1 / 60;

describe("starting a run", () => {
  it("opens on the first level's banner with the run's own figures", () => {
    const state = new WirewormState();
    state.score = 900;
    state.lives = 1;
    state.level = 7;
    startRun(state);
    expect(state.screen).toBe("playing");
    expect(state.phase).toBe("banner");
    expect(state.phaseTimer).toBe(BANNER_TIME);
    expect(state.score).toBe(0);
    expect(state.lives).toBe(START_LIVES);
    expect(state.level).toBe(1);
    expect(state.reachedLevel).toBe(1);
    expect(state.cursor.x).toBe(BAND_CX);
    expect(state.cursor.y).toBe(BAND_CY);
    expect(state.worms).toHaveLength(0);
  });

  it("lays a scatter of inert nodes across the scatter rows alone", () => {
    const state = new WirewormState();
    startRun(state);
    const tiles = (SCATTER_BOTTOM_ROW - SCATTER_TOP_ROW + 1) * COLS;
    expect(state.nodes.length).toBeGreaterThanOrEqual(
      Math.floor(SCATTER_MIN_FRACTION * tiles),
    );
    expect(state.nodes.length).toBeLessThanOrEqual(
      Math.ceil(SCATTER_MAX_FRACTION * tiles),
    );
    expect(state.nodes.every((node) => node.charge === 0)).toBe(true);
    expect(
      state.nodes.every(
        (node) => node.r >= SCATTER_TOP_ROW && node.r <= SCATTER_BOTTOM_ROW,
      ),
    ).toBe(true);
    const tilesSeen = new Set(state.nodes.map((node) => `${node.c},${node.r}`));
    expect(tilesSeen.size).toBe(state.nodes.length);
  });

  it("lays the same field from one seed and a different one from another", () => {
    const first = new WirewormState();
    resetState(first, 7);
    scatterField(first);
    const second = new WirewormState();
    resetState(second, 7);
    scatterField(second);
    const third = new WirewormState();
    resetState(third, 8);
    scatterField(third);
    expect(second.nodes).toEqual(first.nodes);
    expect(third.nodes).not.toEqual(first.nodes);
  });
});

describe("losing a life", () => {
  it("sweeps the board of everything but the field and runs the respawn", () => {
    const state = playingState();
    putNode(state, 4, 4, 2);
    poseWorm(state, 8, 8, 3);
    poseFoe(state, "glitch", 9, 9);
    addBoltTo(state, 300, 400);
    const cues = noCues();
    loseLife(state, cues);
    expect(state.lives).toBe(START_LIVES - 1);
    expect(state.worms).toHaveLength(0);
    expect(state.foes).toHaveLength(0);
    expect(state.bolts).toHaveLength(0);
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0].charge).toBe(2);
    expect(state.cursor.x).toBe(BAND_CX);
    expect(state.phase).toBe("respawn");
    expect(state.phaseTimer).toBe(RESPAWN_TIME);
    expect(cues.life).toBe(true);
  });

  it("ends the run when it takes the last life", () => {
    const state = playingState();
    state.lives = 1;
    state.reachedLevel = 5;
    const cues = noCues();
    loseLife(state, cues);
    expect(state.lives).toBe(0);
    expect(state.screen).toBe("gameover");
    expect(state.reachedLevel).toBe(5);
    expect(cues.gameOver).toBe(true);
  });

  it("gives the cursor its invulnerability as the respawn ends, and a worm", () => {
    const state = playingState();
    state.wormEntry = true;
    loseLife(state, noCues());
    advanceGame(state, RESPAWN_TIME + FRAME, noCues());
    expect(state.phase).toBe("active");
    expect(state.cursor.invulnerable).toBeCloseTo(RESPAWN_INVULN, 6);
    expect(state.worms).toHaveLength(1);
  });
});

describe("clearing a level", () => {
  it("pays the bonus, moves the run on, and leaves the field standing", () => {
    const state = playingState();
    state.level = 3;
    state.reachedLevel = 3;
    putNode(state, 4, 4, 2);
    poseFoe(state, "glitch", 9, 9);
    addBoltTo(state, 300, 400);
    const cues = noCues();
    clearLevel(state, cues);
    expect(state.score).toBe(SCORE_LEVEL_CLEAR * 3);
    expect(state.level).toBe(4);
    expect(state.reachedLevel).toBe(4);
    expect(state.foes).toHaveLength(0);
    expect(state.bolts).toHaveLength(0);
    expect(state.nodes[0].charge).toBe(2);
    expect(state.phase).toBe("banner");
    expect(state.phaseTimer).toBe(BANNER_TIME);
    expect(cues.levelClear).toBe(true);
  });

  it("wins the run on the last level, paying both bonuses", () => {
    const state = playingState();
    state.level = TOTAL_LEVELS;
    state.lives = 2;
    const cues = noCues();
    clearLevel(state, cues);
    expect(state.screen).toBe("victory");
    expect(state.score).toBe(
      SCORE_LEVEL_CLEAR * TOTAL_LEVELS + SCORE_VICTORY * 2,
    );
    expect(cues.victory).toBe(true);
  });
});

describe("the level clears on the step the last segment is removed", () => {
  it("clears when a bolt takes the last one", () => {
    const state = playingState();
    poseWorm(state, 8, 6, 1);
    addBoltTo(state, tileCX(8), tileCY(6));
    advanceGame(state, FRAME, noCues());
    expect(state.level).toBe(2);
    expect(state.phase).toBe("banner");
  });

  it("leaves a board that never held a segment being played", () => {
    const state = playingState();
    advanceGame(state, 5, noCues());
    expect(state.level).toBe(1);
    expect(state.phase).toBe("active");
    expect(state.screen).toBe("playing");
  });

  it("leaves a board whose worms were removed by hand being played", () => {
    const state = playingState();
    poseWorm(state, 8, 6, 2);
    state.worms = [];
    advanceGame(state, FRAME, noCues());
    expect(state.level).toBe(1);
    expect(state.phase).toBe("active");
  });
});

describe("the bonus life", () => {
  it("is granted for each multiple of its figure the score crosses", () => {
    const state = playingState();
    addScore(state, BONUS_LIFE_EVERY - 1);
    expect(state.lives).toBe(START_LIVES);
    addScore(state, 1);
    expect(state.lives).toBe(START_LIVES + 1);
    addScore(state, BONUS_LIFE_EVERY * 2);
    expect(state.lives).toBe(START_LIVES + 3);
  });
});

describe("the phases of play", () => {
  it("gives way from the banner to live play, bringing the level's worm in", () => {
    const state = playingState();
    state.wormEntry = true;
    state.phase = "banner";
    state.phaseTimer = BANNER_TIME;
    advanceGame(state, BANNER_TIME / 2, noCues());
    expect(state.phase).toBe("banner");
    expect(state.worms).toHaveLength(0);
    advanceGame(state, BANNER_TIME / 2 + FRAME, noCues());
    expect(state.phase).toBe("active");
    expect(state.worms).toHaveLength(1);
  });

  it("brings no worm in while the entry gate is held", () => {
    const state = playingState();
    state.phase = "banner";
    state.phaseTimer = BANNER_TIME;
    advanceGame(state, BANNER_TIME + FRAME, noCues());
    expect(state.phase).toBe("active");
    expect(state.worms).toHaveLength(0);
  });

  it("freezes the board while the game is paused, and still keeps time", () => {
    const state = playingState();
    poseWorm(state, 8, 6, 2);
    state.screen = "paused";
    advanceGame(state, 1, noCues());
    expect(state.worms[0].segments[0]).toEqual({ c: 8, r: 6 });
    expect(state.simTime).toBeCloseTo(1, 6);
  });

  it("accumulates simulation time on every screen", () => {
    const state = new WirewormState();
    advanceGame(state, 0.5, noCues());
    expect(state.screen).toBe("title");
    expect(state.simTime).toBeCloseTo(0.5, 6);
  });
});

describe("reset", () => {
  it("returns every declared field to its title value and leaves mute alone", () => {
    const state = playingState();
    state.score = 500;
    state.lives = 1;
    state.level = 9;
    state.reachedLevel = 9;
    state.muted = true;
    state.foeSpawning = false;
    state.wormEntry = false;
    state.cursor.contact = false;
    state.cursor.invulnerable = 2;
    state.fireCooldown = 1;
    state.simTime = 40;
    putNode(state, 3, 3, 3);
    poseWorm(state, 8, 8, 2);
    poseFoe(state, "dropper", 4, 4);
    addBoltTo(state, 100, 200);

    resetState(state, 5);
    expect(state.screen).toBe("title");
    expect(state.phase).toBe("banner");
    expect(state.phaseTimer).toBe(0);
    expect(state.menuIndex).toBe(0);
    expect(state.score).toBe(0);
    expect(state.lives).toBe(START_LIVES);
    expect(state.level).toBe(1);
    expect(state.reachedLevel).toBe(1);
    expect(state.nodes).toHaveLength(0);
    expect(state.worms).toHaveLength(0);
    expect(state.foes).toHaveLength(0);
    expect(state.bolts).toHaveLength(0);
    expect(state.arcs).toHaveLength(0);
    expect(state.cursor).toEqual({
      x: BAND_CX,
      y: BAND_CY,
      invulnerable: 0,
      contact: true,
    });
    expect(state.fireCooldown).toBe(0);
    expect(state.foeSpawning).toBe(true);
    expect(state.wormEntry).toBe(true);
    expect(state.simTime).toBe(0);
    expect(state.rngState).toBe(5);
    expect(state.muted).toBe(true);
  });
});
