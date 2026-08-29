// Fathom — the shape of a dive: laying a maze out, opening it, starting an
// attempt at it, losing a life, clearing it, and descending
// (`specs/progression.md`, `specs/ui.md`).
//
// Every function here is a transition: the current state in, the next state out.
// They are the one place a board is arranged, so the debug surface's poses and
// the game's own screens reach the same arrangement by the same route — a posed
// dive and a played one are the same dive.

import {
  DRIFTER_INTERVAL,
  GRID_COLS,
  GRID_ROWS,
  SCORE_CLEAR,
  START_LIVES,
} from "./constants";
import { centerX, centerY } from "./grid";
import { CORRIDOR } from "./maze";
import { generateMaze } from "./maze-generator";
import { createPredator, rosterForDepth } from "./predators";
import { createDraws } from "./rng";
import { emptyGrid } from "./sensing";
import type { Sheets } from "./assets";
import type {
  FathomState,
  ForagerState,
  MazeState,
  PredatorState,
  Screen,
  Tile,
} from "./state";

/**
 * The dive countdown: three beats, `2.4 s` in all, inside the `1 s` to `3 s`
 * window `specs/ui.md` allows. It is timed on the simulation's own accumulated
 * time, so it gives way after that much game time however the frames that
 * carried it were drawn.
 */
export const COUNTDOWN_BEATS = 3;
export const COUNTDOWN_BEAT = 0.8;
export const COUNTDOWN_TIME = COUNTDOWN_BEATS * COUNTDOWN_BEAT;

/** The cleared interstitial, inside the same window. */
export const CLEARED_TIME = 1.8;

// ---- The board -----------------------------------------------------------

/** One plankton on each corridor tile, and how many that is. */
export function plantPlankton(maze: MazeState): {
  readonly plankton: boolean[];
  readonly planktonRemaining: number;
} {
  const plankton = emptyGrid();
  let planktonRemaining = 0;
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      if (maze.rows[ty][tx] !== CORRIDOR) continue;
      plankton[ty * GRID_COLS + tx] = true;
      planktonRemaining++;
    }
  }
  return { plankton, planktonRemaining };
}

/**
 * The den tiles the roster is housed on, one per predator, cycling the chamber's
 * own tiles. A layout with no chamber houses them on the start tile, where the
 * den mode holds them out of play (`specs/instrumentation.md`).
 */
function denSlots(maze: MazeState): readonly Tile[] {
  return maze.denTiles.length > 0 ? maze.denTiles : [maze.start];
}

/**
 * The roster of `depth`, every predator in the den and unreleased, its release
 * time its slot in the staggered schedule (`specs/predators.md`).
 */
export function housePredators(
  maze: MazeState,
  depth: number,
): PredatorState[] {
  const slots = denSlots(maze);
  return rosterForDepth(depth).map((kind, index) => {
    const tile = slots[index % slots.length];
    return createPredator(kind, tile.tx, tile.ty, index);
  });
}

/** The forager at rest on the center of `tile`, facing up. */
export function restForager(tile: Tile): ForagerState {
  return {
    x: centerX(tile.tx),
    y: centerY(tile.ty),
    facing: "up",
    heading: null,
    desired: null,
  };
}

/**
 * The arrangement every attempt at the current maze starts from
 * (`specs/progression.md`): the forager on its start tile with no brightness,
 * every predator back in the den unreleased with the schedule armed again, no
 * drifters and the cadence restarted, no wavefronts and no ink, and both
 * cooldowns ready. The plankton already eaten stay eaten and what the dive has
 * revealed carries across.
 */
export function startAttempt(state: FathomState): FathomState {
  return {
    ...state,
    forager: restForager(state.maze.start),
    heldDirs: [],
    brightness: 0,
    brightHold: 0,
    sonarCooldown: 0,
    inkCooldown: 0,
    predators: housePredators(state.maze, state.depth),
    drifters: [],
    drifterIn: DRIFTER_INTERVAL,
    pulses: [],
    inkClouds: [],
  };
}

/** A maze opened fresh: full plankton, unrevealed fog, and a first attempt. */
export function openMaze(
  state: FathomState,
  maze: MazeState,
  depth: number,
): FathomState {
  const { plankton, planktonRemaining } = plantPlankton(maze);
  return startAttempt({
    ...state,
    maze,
    depth,
    plankton,
    planktonRemaining,
    revealed: emptyGrid(),
    lit: emptyGrid(),
  });
}

/** A maze laid out afresh off the seeded generator, and opened. */
export function layFreshMaze(state: FathomState, depth: number): FathomState {
  const draws = createDraws(state.rngState);
  const maze = generateMaze(draws);
  return openMaze({ ...state, rngState: draws.state }, maze, depth);
}

// ---- The screens ---------------------------------------------------------

/** The seven screens, which is the domain `setScreen` accepts. */
export const SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "countdown",
  "playing",
  "paused",
  "cleared",
  "gameover",
];

/**
 * How long the screen holds before it gives way on its own, `0` for a screen that
 * waits on the player instead (`specs/ui.md`).
 */
function screenHold(screen: Screen): number {
  if (screen === "countdown") return COUNTDOWN_TIME;
  if (screen === "cleared") return CLEARED_TIME;
  return 0;
}

/**
 * The game showing `screen`, with that screen's own hold started.
 *
 * It is the one way a screen is entered, so the debug surface's `setScreen` and
 * the game's own transitions reach the same arrangement by the same route: a
 * posed screen and a played one are the same screen. It sets the screen and
 * nothing else — the den's staggered schedule is timed from live play because the
 * schedule runs only while `screen` is `"playing"` (`specs/predators.md`), not
 * because entering it touches a predator.
 */
export function enterScreen(state: FathomState, screen: Screen): FathomState {
  return { ...state, screen, screenIn: screenHold(screen) };
}

/** The countdown at the top of a maze, which live play resumes through. */
export function toCountdown(state: FathomState): FathomState {
  return enterScreen(state, "countdown");
}

/**
 * Live play beginning, which is where the den's staggered schedule is timed
 * from (`specs/predators.md`).
 */
export function beginLivePlay(state: FathomState): FathomState {
  return enterScreen(state, "playing");
}

/**
 * The opening of a dive, which `DIVE`, `RESTART` and `PLAY AGAIN` all reach
 * (`specs/ui.md`): the score, the lives and the depth back to where a dive
 * begins, a maze laid out afresh, and the countdown.
 */
export function beginDive(state: FathomState): FathomState {
  const fresh = layFreshMaze({ ...state, score: 0, lives: START_LIVES }, 1);
  return toCountdown({ ...fresh, menuIndex: 0 });
}

/** The title screen, with the run restored to the values a dive begins from. */
export function toTitle(state: FathomState): FathomState {
  const fresh = layFreshMaze({ ...state, score: 0, lives: START_LIVES }, 1);
  return enterScreen({ ...fresh, menuIndex: 0 }, "title");
}

/** Another attempt at the same maze, at the same depth. */
export function retryMaze(state: FathomState): FathomState {
  return toCountdown(startAttempt(state));
}

/**
 * Contact with a predator (`specs/gameplay.md`): a life, unless none is left in
 * reserve, in which case the run ends here.
 */
export function loseLife(state: FathomState): FathomState {
  if (state.lives <= 0) {
    return enterScreen({ ...state, menuIndex: 0 }, "gameover");
  }
  return retryMaze({ ...state, lives: state.lives - 1 });
}

/** The maze cleared: the bonus, and the interstitial before the descent. */
export function clearMaze(state: FathomState): FathomState {
  return enterScreen({ ...state, score: state.score + SCORE_CLEAR }, "cleared");
}

/** The next maze, one depth down, opening on the countdown. */
export function descend(state: FathomState): FathomState {
  return toCountdown(layFreshMaze(state, state.depth + 1));
}

// ---- The opening state ---------------------------------------------------

/**
 * Every field of the state at its title-screen value, off `seed`.
 *
 * This is what `initialize` builds and what the debug surface's `reset` restores,
 * so a reset leaves the game indistinguishable from one freshly started. The art
 * and the mute bit are carried through: the sheets are the project's rather than
 * a value a dive opens with, and muting is a player preference
 * (`specs/instrumentation.md`).
 */
export function openingState(
  sheets: Sheets,
  seed: number,
  muted: boolean,
): FathomState {
  const draws = createDraws(seed >>> 0);
  const maze = generateMaze(draws);
  const { plankton, planktonRemaining } = plantPlankton(maze);
  return {
    screen: "title",
    depth: 1,
    score: 0,
    lives: START_LIVES,
    muted,
    simTime: 0,
    carry: 0,
    rngState: draws.state,
    menuIndex: 0,
    screenIn: 0,
    maze,
    plankton,
    planktonRemaining,
    revealed: emptyGrid(),
    lit: emptyGrid(),
    brightness: 0,
    brightHold: 0,
    sonarCooldown: 0,
    inkCooldown: 0,
    forager: restForager(maze.start),
    drifters: [],
    predators: housePredators(maze, 1),
    drifterIn: DRIFTER_INTERVAL,
    pulses: [],
    inkClouds: [],
    heldDirs: [],
    sheets,
  };
}
