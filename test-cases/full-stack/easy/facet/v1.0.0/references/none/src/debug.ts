// Facet — the debugging and automation surface, `window.__facet`.
//
// `specs/instrumentation.md` specifies it and this file installs it, in two
// layers. `createDebugApi()` bundles the POSE SURFACE: every operation a read
// or a pose over `FacetState`, state in and state out, holding nothing. The
// logic behind each one lives in `src/core/debug.ts`, `src/core/flow.ts`, and
// `src/core/controls.ts` — the same functions the game itself runs on, which is
// what makes "the game's own acceptance rules, chain resolution, scoring, and
// end conditions run from there exactly as they do in play" true rather than
// merely intended. The game's `initialize` returns the bundle, and the runtime
// hands it back from `runtime.debug`.
//
// `installDebugApi` then wraps that bundle and the runtime into the object
// `window.__facet` carries, whose operations apply each pose to the live state
// — plus the two operations that are not poses at all: `setAutoStep` and
// `advance`, the CLOCK. This build stands on no engine, so nothing outside it
// owns its clock; without those two a scenario could only be driven by waiting,
// and a check that waits measures the machine it ran on.
//
// The pointer operations do not stand in for the runtime's pointer: they feed
// the SAME resolution path a player's pointer feeds (`src/core/controls.ts`),
// so the hit radius, the four press rows, the drag, and the acceptance rules
// all run exactly as they do in play, and each call takes effect immediately in
// the state it returns rather than waiting on a frame. Everything else about
// driving a browser game stays absent: there is no operation for the registered
// actions (the runtime's keyboard is driven by dispatching real key events at
// the page) and none for the overlay (the runtime owns the backtick key and the
// panel).
//
// The surface is inert during normal play: nothing below runs until something
// calls it.

import { FACET_DEBUG_VERSION } from "./constants";
import {
  clearSelection,
  loadBoard,
  openHowTo,
  pauseGame,
  poseSwap,
  pointerDown,
  pointerMove,
  pointerUp,
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
  type FacetState,
} from "./core";

/** The `window` property the installed API is published on. */
export const FACET_HANDLE = "__facet";

/**
 * The pose surface. Every pose takes the current state and returns the next;
 * the one reading, `snapshot`, takes the current state and returns what it
 * read.
 */
export interface FacetDebugApi {
  version: number;
  reset(state: FacetState, options?: { seed?: number }): FacetState;
  snapshot(state: FacetState): FacetSnapshot;
  start(state: FacetState): FacetState;
  openHowTo(state: FacetState): FacetState;
  pause(state: FacetState): FacetState;
  resume(state: FacetState): FacetState;
  quit(state: FacetState): FacetState;
  loadBoard(state: FacetState, rows: readonly string[]): FacetState;
  setGem(
    state: FacetState,
    col: number,
    row: number,
    token: string,
  ): FacetState;
  setScore(state: FacetState, points: number): FacetState;
  setLevel(state: FacetState, level: number): FacetState;
  setLevelScore(state: FacetState, points: number): FacetState;
  setCursor(state: FacetState, col: number, row: number): FacetState;
  setSelection(state: FacetState, col: number, row: number): FacetState;
  clearSelection(state: FacetState): FacetState;
  requestSwap(
    state: FacetState,
    colA: number,
    rowA: number,
    colB: number,
    rowB: number,
  ): FacetState;
  pointerDown(state: FacetState, x: number, y: number): FacetState;
  pointerMove(state: FacetState, x: number, y: number): FacetState;
  pointerUp(state: FacetState): FacetState;
}

/**
 * Bundle the surface. It holds nothing: every operation is handed its state,
 * and each one is the core function the game itself uses for that move.
 *
 * A pose plays no cue, so the events the core reports alongside a state are
 * dropped here — "a cue is played by a frame, never by a pose of the debug
 * surface" (specs/ui.md).
 */
export function createDebugApi(): FacetDebugApi {
  return {
    version: FACET_DEBUG_VERSION,
    reset,
    snapshot,
    start: startRound,
    openHowTo,
    pause: pauseGame,
    resume: resumeGame,
    quit: quitToTitle,
    loadBoard,
    setGem,
    setScore,
    setLevel,
    setLevelScore,
    setCursor,
    setSelection,
    clearSelection,
    requestSwap: poseSwap,
    pointerDown: (state, x, y) => pointerDown(state, x, y).state,
    pointerMove: (state, x, y) => pointerMove(state, x, y).state,
    pointerUp,
  };
}

/**
 * What the installed surface reaches on the runtime: the live state, the pose
 * applier, and the clock. Structural on purpose — `src/runtime.ts` satisfies
 * it without knowing this file exists, and a test can hand the surface a host
 * of its own.
 */
export interface DebugHost {
  readonly state: FacetState;
  /** Replace the live state with what `pose` returns for it. */
  apply(pose: (state: FacetState) => FacetState): void;
  /** Take the game off the wall clock, or give it back. */
  setAutoStep(enabled: boolean): void;
  /** Run `frames` whole frames covering `seconds` of game time. */
  advance(seconds: number, frames?: number): void;
}

/** The object `window.__facet` carries (specs/instrumentation.md). */
export interface FacetWindowApi {
  version: number;
  setAutoStep(enabled: boolean): void;
  advance(seconds: number, frames?: number): void;
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

/** Build the installed surface over one runtime and its pose surface. */
export function createWindowApi(
  host: DebugHost,
  api: FacetDebugApi,
): FacetWindowApi {
  return {
    version: api.version,

    /**
     * Take the game off real time, and give it back. `false` stops the frame
     * loop advancing the simulation from the wall clock, so the game changes
     * only when `advance` says so; `true` returns it to running itself, which
     * is how a build starts and how it is played. Drawing is unaffected either
     * way: the loop keeps rendering, so the canvas shows the state the most
     * recent frame left.
     */
    setAutoStep(enabled) {
      host.setAutoStep(Boolean(enabled));
    },

    /**
     * Run `frames` whole frames covering `seconds` of game time, each worth
     * `seconds / frames`, immediately and in order. Each is a real frame — the
     * same update the loop runs, then a render — so the game's own chain
     * cadence and end conditions produce the result and the canvas reflects
     * it. Advancing while the game is still stepping automatically ADDS to
     * what the wall clock is already doing, so a scenario that must be
     * reproducible calls `setAutoStep(false)` first.
     */
    advance(seconds, frames = 1) {
      host.advance(seconds, frames);
    },

    reset(options) {
      host.apply((state) => api.reset(state, options));
    },

    snapshot() {
      return api.snapshot(host.state);
    },

    start() {
      host.apply((state) => api.start(state));
    },

    openHowTo() {
      host.apply((state) => api.openHowTo(state));
    },

    pause() {
      host.apply((state) => api.pause(state));
    },

    resume() {
      host.apply((state) => api.resume(state));
    },

    quit() {
      host.apply((state) => api.quit(state));
    },

    loadBoard(rows) {
      host.apply((state) => api.loadBoard(state, rows));
    },

    setGem(col, row, token) {
      host.apply((state) => api.setGem(state, col, row, token));
    },

    setScore(points) {
      host.apply((state) => api.setScore(state, points));
    },

    setLevel(level) {
      host.apply((state) => api.setLevel(state, level));
    },

    setLevelScore(points) {
      host.apply((state) => api.setLevelScore(state, points));
    },

    setCursor(col, row) {
      host.apply((state) => api.setCursor(state, col, row));
    },

    setSelection(col, row) {
      host.apply((state) => api.setSelection(state, col, row));
    },

    clearSelection() {
      host.apply((state) => api.clearSelection(state));
    },

    requestSwap(colA, rowA, colB, rowB) {
      host.apply((state) => api.requestSwap(state, colA, rowA, colB, rowB));
    },

    // The three pointer poses take effect the moment they are called, in the
    // state `apply` stores back — no frame need pass between them, so a
    // selection and the swap it leads to are both posed without advancing the
    // game at all (specs/instrumentation.md).
    pointerDown(x, y) {
      host.apply((state) => api.pointerDown(state, x, y));
    },

    pointerMove(x, y) {
      host.apply((state) => api.pointerMove(state, x, y));
    },

    pointerUp() {
      host.apply((state) => api.pointerUp(state));
    },
  };
}

/**
 * Install the surface on `window.__facet` and return the function that removes
 * it again, while the installed object is still the one this call published.
 * `window` is the global object, so the same install serves the browser and an
 * in-process test alike.
 */
export function installDebugApi(
  host: DebugHost,
  api: FacetDebugApi,
): () => void {
  const installed = createWindowApi(host, api);
  const target = globalThis as unknown as Record<string, unknown>;
  target[FACET_HANDLE] = installed;
  return () => {
    if (target[FACET_HANDLE] === installed) delete target[FACET_HANDLE];
  };
}
