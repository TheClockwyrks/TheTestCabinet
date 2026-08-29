// The shape of a dive, and the snapshot that reports it, as pure transitions.
//
// Nothing here stands the engine up: every function under test takes a state and
// returns the next one, so a check is an ordinary call. `src/engine.test.ts` is
// where the same transitions are driven through a real engine.

import { describe, expect, it } from "vitest";
import {
  DRIFTER_INTERVAL,
  GRID_COLS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  GRID_ROWS,
  SCORE_CLEAR,
  SONAR_RANGE_BASE,
  START_LIVES,
  TILE,
} from "./constants";
import {
  CLEARED_TIME,
  COUNTDOWN_TIME,
  beginDive,
  clearMaze,
  descend,
  housePredators,
  loseLife,
  openingState,
  plantPlankton,
  startAttempt,
  toTitle,
} from "./flow";
import { CORRIDOR } from "./maze";
import { mazeConforms } from "./maze-rules";
import { snapshotOf } from "./snapshot";
import type { Sheets } from "./assets";
import type { FathomState } from "./state";

/** A sheet set with no frames, which is what a host that cannot decode has. */
const NO_ART: Sheets = {
  glimmerfin: [],
  lanternjaw: [],
  gloamfin: [],
  flarefish: [],
  drifter: [],
  flareBloom: [],
  trench: [],
};

function opening(seed = 1): FathomState {
  return openingState(NO_ART, seed, false);
}

describe("the opening state", () => {
  it("opens on the title screen with a conforming maze", () => {
    const state = opening();
    expect(state.screen).toBe("title");
    expect(state.score).toBe(0);
    expect(state.lives).toBe(START_LIVES);
    expect(state.depth).toBe(1);
    expect(state.brightness).toBe(0);
    expect(state.simTime).toBe(0);
    expect(state.brightHold).toBe(0);
    expect(state.sonarCooldown).toBe(0);
    expect(state.inkCooldown).toBe(0);
    expect(state.pulses).toEqual([]);
    expect(state.inkClouds).toEqual([]);
    expect(state.drifters).toEqual([]);
    expect(mazeConforms(state.maze)).toBe(true);
  });

  it("opens with the fog fully unrevealed and a plankton on every corridor", () => {
    const state = opening();
    expect(state.revealed.some(Boolean)).toBe(false);
    expect(state.lit.some(Boolean)).toBe(false);
    let corridors = 0;
    for (const row of state.maze.rows) {
      for (const tile of row) if (tile === CORRIDOR) corridors++;
    }
    expect(state.planktonRemaining).toBe(corridors);
  });

  it("houses the whole roster in the den, unreleased", () => {
    const state = opening();
    expect(state.predators.map((p) => p.kind)).toEqual([
      "lanternjaw",
      "gloamfin",
      "flarefish",
    ]);
    expect(state.predators.every((p) => p.mode === "den")).toBe(true);
    expect(state.predators.every((p) => !p.released)).toBe(true);
    // Every creature opens with its own mind running.
    expect(state.predators.every((p) => p.mind)).toBe(true);
    // The release times are the staggered schedule, one slot each.
    expect(state.predators.map((p) => p.releaseIn)).toEqual([0, 5, 10]);
  });

  it("reaches the same maze from the same seed and a different one otherwise", () => {
    expect(opening(7).maze.rows).toEqual(opening(7).maze.rows);
    expect(opening(7).maze.rows).not.toEqual(opening(8).maze.rows);
  });
});

describe("the shape of a dive", () => {
  it("opens a dive on the countdown, from the values a dive begins from", () => {
    const played: FathomState = {
      ...opening(),
      score: 900,
      lives: 0,
      depth: 5,
      screen: "gameover",
    };
    const dive = beginDive(played);
    expect(dive.screen).toBe("countdown");
    expect(dive.screenIn).toBe(COUNTDOWN_TIME);
    expect(dive.score).toBe(0);
    expect(dive.lives).toBe(START_LIVES);
    expect(dive.depth).toBe(1);
    expect(dive.menuIndex).toBe(0);
  });

  it("returns to the title with the run restored", () => {
    const title = toTitle({ ...opening(), score: 400, depth: 3, lives: 1 });
    expect(title.screen).toBe("title");
    expect(title.score).toBe(0);
    expect(title.depth).toBe(1);
    expect(title.lives).toBe(START_LIVES);
  });

  it("starts another attempt without forgetting the maze", () => {
    const dive = beginDive(opening());
    const grazed: FathomState = {
      ...dive,
      planktonRemaining: dive.planktonRemaining - 5,
      revealed: dive.revealed.map(() => true),
      score: 50,
      brightness: 0.8,
      sonarCooldown: 1.2,
      drifterIn: 3,
    };
    const again = startAttempt(grazed);
    expect(again.planktonRemaining).toBe(grazed.planktonRemaining);
    expect(again.revealed).toEqual(grazed.revealed);
    expect(again.score).toBe(50);
    expect(again.maze.rows).toEqual(grazed.maze.rows);
    expect(again.brightness).toBe(0);
    expect(again.sonarCooldown).toBe(0);
    expect(again.drifterIn).toBe(DRIFTER_INTERVAL);
    expect(again.predators.every((p) => !p.released)).toBe(true);
  });

  it("costs a life while one is in reserve and ends the run otherwise", () => {
    const live = { ...beginDive(opening()), screen: "playing" as const };
    const once = loseLife(live);
    expect(once.lives).toBe(START_LIVES - 1);
    expect(once.screen).toBe("countdown");

    const last = loseLife({ ...live, lives: 0 });
    expect(last.lives).toBe(0);
    expect(last.screen).toBe("gameover");
    expect(last.menuIndex).toBe(0);
  });

  it("clears a maze, then descends to a fresh one a depth down", () => {
    const live = { ...beginDive(opening()), screen: "playing" as const };
    const cleared = clearMaze(live);
    expect(cleared.screen).toBe("cleared");
    expect(cleared.screenIn).toBe(CLEARED_TIME);
    expect(cleared.score).toBe(SCORE_CLEAR);

    const deeper = descend(cleared);
    expect(deeper.depth).toBe(2);
    expect(deeper.screen).toBe("countdown");
    expect(deeper.score).toBe(SCORE_CLEAR);
    expect(deeper.revealed.some(Boolean)).toBe(false);
    expect(mazeConforms(deeper.maze)).toBe(true);
  });

  it("plants one plankton per corridor tile and none in the den", () => {
    const state = opening();
    const { plankton } = plantPlankton(state.maze);
    for (let ty = 0; ty < GRID_ROWS; ty++) {
      for (let tx = 0; tx < GRID_COLS; tx++) {
        const at = state.maze.rows[ty][tx];
        expect(plankton[ty * GRID_COLS + tx]).toBe(at === CORRIDOR);
      }
    }
  });

  it("houses a deeper roster on the den's own tiles", () => {
    const state = opening();
    const deep = housePredators(state.maze, 4);
    expect(deep.length).toBe(6);
    for (const predator of deep) {
      const tx = Math.round((predator.x - GRID_ORIGIN_X - TILE / 2) / TILE);
      const ty = Math.round((predator.y - GRID_ORIGIN_Y - TILE / 2) / TILE);
      expect(state.maze.rows[ty][tx]).toBe("d");
    }
  });
});

describe("the snapshot", () => {
  it("reports the grid, the maze and the fog exactly as the state holds them", () => {
    const state = opening();
    const snapshot = snapshotOf(state, 1);
    expect(snapshot.grid).toEqual({
      cols: GRID_COLS,
      rows: GRID_ROWS,
      tile: TILE,
      originX: GRID_ORIGIN_X,
      originY: GRID_ORIGIN_Y,
    });
    expect(snapshot.tiles).toEqual(state.maze.rows);
    expect(snapshot.visibility.length).toBe(GRID_ROWS);
    expect(snapshot.visibility.every((row) => row.length === GRID_COLS)).toBe(
      true,
    );
    expect(snapshot.visibility.join("")).toBe(
      "u".repeat(GRID_COLS * GRID_ROWS),
    );
  });

  it("reports each predator's own fields and null for the rest", () => {
    const snapshot = snapshotOf(opening(), 1);
    const [lanternjaw, gloamfin, flarefish] = snapshot.predators;

    expect(lanternjaw.detectRange).toBe(128);
    expect(lanternjaw.hearingRange).toBeNull();
    expect(lanternjaw.hearingLock).toBeNull();
    expect(lanternjaw.flareCharging).toBeNull();
    expect(lanternjaw.flaring).toBeNull();
    expect(lanternjaw.flareRadius).toBeNull();
    expect(lanternjaw.alert).toBe(false);

    expect(gloamfin.detectRange).toBeNull();
    expect(gloamfin.hearingRange).toBe(64);
    expect(gloamfin.hearingLock).toBe(false);

    expect(flarefish.detectRange).toBe(128);
    expect(flarefish.flareCharging).toBe(false);
    expect(flarefish.flaring).toBe(false);
    expect(flarefish.flareRadius).toBe(0);
  });

  it("is JSON-serializable and reports the sonar range for the depth", () => {
    const state = { ...opening(), depth: 3 };
    const snapshot = snapshotOf(state, 1);
    expect(snapshot.sonar.range).toBe(SONAR_RANGE_BASE - 2);
    expect(snapshot.sonar.ready).toBe(true);
    expect(snapshot.ink.ready).toBe(true);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});
