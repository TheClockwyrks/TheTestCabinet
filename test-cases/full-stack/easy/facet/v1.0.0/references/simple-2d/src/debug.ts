// Facet — the debugging and automation surface.
//
// `specs/instrumentation.md` specifies it and this file builds it.
// `createDebugApi()` returns the bundle, `initialize` returns it beside the
// state it built as `[state, debug]`, and the engine hands that same object back
// from `engine.debug` — the one way a caller reaches it. Nothing is installed on
// the page. It holds no state, reaches nothing global, and is inert during
// normal play: nothing below runs until something calls it.
//
// Every operation is written in the shape of `update`, because nothing holds a
// writable state. A POSE takes the current state and returns the next —
// `loadBoard(state, rows)` — and a caller drives it through
// `engine.apply((s) => debug.loadBoard(s, rows))`; a READING takes the state and
// returns what it read — `debug.snapshot(engine.state)`.
//
// The logic behind each operation is `src/core/`'s: `debug.ts` for the poses
// over the figures and the board, `flow.ts` for the screens, and `controls.ts`
// for the pointer — the same functions the game itself runs on, which is what
// makes "the game's own acceptance rules, chain resolution, scoring, and end
// conditions run from there exactly as they do in play" true rather than merely
// intended. This file is the conversion at each end of them, from the state
// `specs/state.md` declares to the record those functions read and back.
//
// The pointer operations do not stand in for the engine's pointer: they feed the
// SAME resolution path a player's pointer feeds, so the hit radius, the four
// press rows, the drag, and the acceptance rules all run exactly as they do in
// play, and each call takes effect immediately in the state it returns rather
// than waiting on a frame. What the engine owns is absent by design: the clock
// (`engine.advance` and its replaceable clock), the keyboard (real key events
// dispatched at the engine's event target), and the overlay (the backtick key
// and the panel) carry no operation here.
//
// A POSE PLAYS NO CUE. The core reports the events a transition raised beside
// the state; they are dropped here, because "a cue is played by a frame, never
// by a pose of the debug surface" (specs/ui.md).

import { fromCore, toCore } from "./bridge";
import { FACET_DEBUG_VERSION } from "./constants";
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
} from "./core";
import type { FacetState } from "./game";
import type { DeepReadonly } from "ts-essentials";

export type { FacetSnapshot };

/** A read-only view of the state, which is what every operation is handed. */
type View = DeepReadonly<FacetState>;

/**
 * The surface. Every pose takes the current state and returns the next; the one
 * reading, `snapshot`, takes the current state and returns what it read.
 */
export interface FacetDebugApi {
  version: number;
  reset(state: View, options?: { seed?: number }): FacetState;
  snapshot(state: View): FacetSnapshot;
  start(state: View): FacetState;
  openHowTo(state: View): FacetState;
  pause(state: View): FacetState;
  resume(state: View): FacetState;
  quit(state: View): FacetState;
  loadBoard(state: View, rows: readonly string[]): FacetState;
  setGem(state: View, col: number, row: number, token: string): FacetState;
  setScore(state: View, points: number): FacetState;
  setLevel(state: View, level: number): FacetState;
  setLevelScore(state: View, points: number): FacetState;
  setCursor(state: View, col: number, row: number): FacetState;
  setSelection(state: View, col: number, row: number): FacetState;
  clearSelection(state: View): FacetState;
  requestSwap(
    state: View,
    colA: number,
    rowA: number,
    colB: number,
    rowB: number,
  ): FacetState;
  pointerDown(state: View, x: number, y: number): FacetState;
  pointerMove(state: View, x: number, y: number): FacetState;
  pointerUp(state: View): FacetState;
}

/** Build the bundle. It holds nothing: every operation is handed its state. */
export function createDebugApi(): FacetDebugApi {
  return {
    version: FACET_DEBUG_VERSION,
    reset: (state, options) => fromCore(reset(toCore(state), options)),
    snapshot: (state) => snapshot(toCore(state)),
    start: (state) => fromCore(startRound(toCore(state))),
    openHowTo: (state) => fromCore(openHowTo(toCore(state))),
    pause: (state) => fromCore(pauseGame(toCore(state))),
    resume: (state) => fromCore(resumeGame(toCore(state))),
    quit: (state) => fromCore(quitToTitle(toCore(state))),
    loadBoard: (state, rows) => fromCore(loadBoard(toCore(state), rows)),
    setGem: (state, col, row, token) =>
      fromCore(setGem(toCore(state), col, row, token)),
    setScore: (state, points) => fromCore(setScore(toCore(state), points)),
    setLevel: (state, level) => fromCore(setLevel(toCore(state), level)),
    setLevelScore: (state, points) =>
      fromCore(setLevelScore(toCore(state), points)),
    setCursor: (state, col, row) =>
      fromCore(setCursor(toCore(state), col, row)),
    setSelection: (state, col, row) =>
      fromCore(setSelection(toCore(state), col, row)),
    clearSelection: (state) => fromCore(clearSelection(toCore(state))),
    requestSwap: (state, colA, rowA, colB, rowB) =>
      fromCore(poseSwap(toCore(state), colA, rowA, colB, rowB)),
    pointerDown: (state, x, y) =>
      fromCore(pointerDown(toCore(state), x, y).state),
    pointerMove: (state, x, y) =>
      fromCore(pointerMove(toCore(state), x, y).state),
    pointerUp: (state) => fromCore(pointerUp(toCore(state))),
  };
}
