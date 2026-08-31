// Facet — the debugging and automation surface.
//
// `specs/instrumentation.md` specifies it and this file implements it.
// `createDebugApi` builds it, `FacetInstance.initialize` returns it, and the
// engine holds that same object and returns it from `engine.debug` — the one
// way a caller reaches it. Nothing is installed on the page.
//
// Every operation acts on the LIVE game at the moment it is called, reaching
// the open world through the accessor the instance supplies — `engine.world` at
// the call — and takes only the parameters its own heading names. A POSE
// arranges the running game through the same systems play uses and returns
// nothing; a READING returns plain data built at the call and changes nothing.
//
// EVERY POSE IS A CORE FUNCTION. The logic behind each one lives in
// `src/core/debug.ts`, `src/core/flow.ts`, and `src/core/controls.ts` — the
// same functions the game itself runs on, reached the same way through
// `src/bridge.ts` — which is what makes "the game's own acceptance rules, chain
// resolution, scoring, and end conditions run from there exactly as they do in
// play" true rather than merely intended. The pointer operations in particular
// do not stand in for the engine's pointer: they feed the SAME per-sample
// resolution the player controller feeds, so the hit radius, the four press
// rows, the drag, and the acceptance rules all run exactly as they do in play,
// and each call takes effect immediately rather than waiting on a frame.
//
// TWO OPERATIONS ARE ABSENT ON PURPOSE. `setAutoStep` and `advance` are the
// CLOCK, and the clock is the engine's: `engine.setClock` takes the game off
// real time and `engine.advance` steps it a counted number of frames
// (engine/frame.md). The keyboard and the overlay are the engine's for the same
// reason, so the surface carries no operation for either.
//
// NO POSE PLAYS A CUE. "A cue is played by a frame, never by a pose of the
// debug surface" (specs/ui.md), so the events the core reports alongside a
// state are dropped here; `src/frame.ts` plays what a frame raised.
//
// A POSE DOES SHOW ITS EFFECTS, because a scenario that poses a swap and then
// looks at the board should see the board a player would see. A pose resolves
// its chain step between frames, so `pose` below reports that one transition to
// the presentation itself rather than leaving a frame to notice it, and a pose
// that replaces the board outright — a fresh deal, a `loadBoard`, a `reset` —
// drops whatever is still flying, because it belongs to a board that is gone.
//
// The surface is inert during normal play: nothing below runs until something
// calls it.

import type { World } from "@test-cabinet/structured-2d";
import { assets } from "./assets";
import { Bench } from "./bench";
import { applyCore, toCore } from "./bridge";
import { FACET_DEBUG_VERSION } from "./constants";
import { reportFor } from "./steps";
import {
  clearSelection,
  loadBoard,
  openHowTo,
  pauseGame,
  pointerDown,
  pointerMove,
  pointerUp,
  poseSwap,
  quitToTitle,
  reset,
  resumeGame,
  setCursor,
  setGem,
  setLevel,
  setLevelScore,
  setScore,
  setSelection,
  snapshot,
  startRound,
  type FacetSnapshot,
  type FacetState as CoreState,
} from "./core";
import { facetState, type FacetState } from "./game";

export type { FacetSnapshot };

/**
 * The surface. Every pose acts on the live world at the call and returns
 * nothing; the one reading, `snapshot`, returns what it read.
 */
export interface FacetDebugApi {
  version: number;
  reset(options?: { seed?: number }): void;
  snapshot(): FacetSnapshot;
  start(): void;
  openHowTo(): void;
  pause(): void;
  resume(): void;
  quit(): void;
  loadBoard(rows: readonly string[]): void;
  setGem(col: number, row: number, token: string): void;
  setScore(points: number): void;
  setLevel(level: number): void;
  setLevelScore(points: number): void;
  setCursor(col: number, row: number): void;
  setSelection(col: number, row: number): void;
  clearSelection(): void;
  requestSwap(colA: number, rowA: number, colB: number, rowB: number): void;
  pointerDown(x: number, y: number): void;
  pointerMove(x: number, y: number): void;
  pointerUp(): void;
}

/**
 * Build the surface over an accessor for the open world. It holds nothing:
 * every operation reads the world — and the state it carries — at the moment it
 * is called, so the surface follows the live game for the life of the engine.
 */
export function createDebugApi(world: () => World): FacetDebugApi {
  const live = (): FacetState => facetState(world());

  /** One pose: the live state in, the core's own function, the result back. */
  const pose = (apply: (state: CoreState) => CoreState): void => {
    const state = live();
    const before = toCore(state);
    const after = apply(before);
    applyCore(state, after);

    const presentation = world().find(Bench)?.presentation;
    if (presentation === undefined) return;
    // A board that changed with no chain step to explain it is a different
    // board entirely, and what is still flying belongs to the one that is gone.
    if (after.board !== before.board && after.chainStep <= before.chainStep) {
      presentation.clear();
    }
    const report = reportFor(before, after);
    if (report !== null) presentation.push([report], assets());
  };

  return {
    version: FACET_DEBUG_VERSION,

    /**
     * Every declared field back at its title-screen value, with `rngState`
     * seeded from `options.seed` or `DEFAULT_SEED`. `muted` is deliberately
     * untouched: the engine owns muting, and a reset is not a reason to start
     * making noise again.
     */
    reset(options) {
      pose((state) => reset(state, options));
    },

    /** A pure read of the state. It changes nothing. */
    snapshot() {
      return snapshot(toCore(live()));
    },

    /**
     * The choice of `PLAY` from the title menu, which is the same choice
     * `PLAY AGAIN` makes from `gameover`: a fresh round on an opening board
     * dealt through the game's own code.
     */
    start() {
      pose(startRound);
    },

    /** The choice of `HOW TO PLAY` from the title menu. */
    openHowTo() {
      pose(openHowTo);
    },

    /** The `pause` action from `playing`. Every timer holds where it stands. */
    pause() {
      pose(pauseGame);
    },

    /** The choice of `RESUME` from the pause menu. */
    resume() {
      pose(resumeGame);
    },

    /** The choice of `QUIT`, which both the pause and game-over menus offer. */
    quit() {
      pose(quitToTitle);
    },

    /**
     * An arbitrary board posed onto the `playing` screen, settled, with
     * nothing selected. The notation is validated as it is parsed, and a board
     * posed this way is a board like any other: it rests exactly as it was
     * written until a swap is accepted on it, and the rules govern it
     * unchanged from there.
     */
    loadBoard(rows) {
      pose((state) => loadBoard(state, rows));
    },

    /** One cell of the board written; everything else stands. */
    setGem(col, row, token) {
      pose((state) => setGem(state, col, row, token));
    },

    /** `score` set. `levelScore` is its own figure. */
    setScore(points) {
      pose((state) => setScore(state, points));
    },

    /** `level` set, a whole number of at least `1`. */
    setLevel(level) {
      pose((state) => setLevel(state, level));
    },

    /** `levelScore` set; the level condition is read when a chain settles. */
    setLevelScore(points) {
      pose((state) => setLevelScore(state, points));
    },

    /** The cursor moved, within the board's dimensions. */
    setCursor(col, row) {
      pose((state) => setCursor(state, col, row));
    },

    /** A cell made the selection. No swap is requested. */
    setSelection(col, row) {
      pose((state) => setSelection(state, col, row));
    },

    /** Nothing selected. The cursor, the board, and the phase stand. */
    clearSelection() {
      pose(clearSelection);
    },

    /**
     * A swap posed, through the same acceptance path a player's swap takes, so
     * R1, R2, and R3 decide it and nothing is bypassed. It names both cells
     * itself, so the selection stands where it was either way.
     */
    requestSwap(colA, rowA, colB, rowB) {
      pose((state) => poseSwap(state, colA, rowA, colB, rowB));
    },

    /** A press, resolved immediately through the real input path. */
    pointerDown(x, y) {
      pose((state) => pointerDown(state, x, y).state);
    },

    /** A move, resolved immediately: a drag's swap, or nothing. */
    pointerMove(x, y) {
      pose((state) => pointerMove(state, x, y).state);
    },

    /** A release, which ends the drag whatever it did. */
    pointerUp() {
      pose(pointerUp);
    },
  };
}
