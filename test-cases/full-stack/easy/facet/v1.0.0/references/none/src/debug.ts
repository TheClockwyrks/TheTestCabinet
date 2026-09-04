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
// so the screen's targets, the hit radius, the five press rows, the offer a
// move makes and withdraws, and the release that plays it all run exactly as
// they do in play. Each carries the device that drove it, so a posed touch and
// a posed mouse differ only in what the state reports, and each call takes
// effect immediately in the state it returns rather than waiting on a frame. Everything else about
// driving a browser game stays absent: there is no operation for the registered
// actions (the runtime's keyboard is driven by dispatching real key events at
// the page) and none for the overlay (the runtime owns the backtick key and the
// panel).
//
// The surface is inert during normal play: nothing below runs until something
// calls it.

import { FACET_DEBUG_VERSION } from "./constants";
import {
  clearOffer,
  clearSelection,
  continueLevel,
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
  setBestChain,
  setBestMove,
  setGem,
  setLevel,
  setLevelScore,
  setOffer,
  setScore,
  setSelection,
  snapshot,
  startRound,
  type FacetSnapshot,
  type FacetState,
  type PointerDevice,
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
  setBestChain(state: FacetState, chainStep: number): FacetState;
  setBestMove(state: FacetState, points: number): FacetState;
  continueLevel(state: FacetState): FacetState;
  setSelection(state: FacetState, col: number, row: number): FacetState;
  clearSelection(state: FacetState): FacetState;
  setOffer(state: FacetState, col: number, row: number): FacetState;
  clearOffer(state: FacetState): FacetState;
  requestSwap(
    state: FacetState,
    colA: number,
    rowA: number,
    colB: number,
    rowB: number,
  ): FacetState;
  pointerDown(
    state: FacetState,
    x: number,
    y: number,
    device?: PointerDevice,
  ): FacetState;
  pointerMove(
    state: FacetState,
    x: number,
    y: number,
    device?: PointerDevice,
  ): FacetState;
  pointerUp(state: FacetState, device?: PointerDevice): FacetState;
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
    setBestChain,
    setBestMove,
    continueLevel,
    setSelection,
    clearSelection,
    setOffer,
    clearOffer,
    requestSwap: poseSwap,
    pointerDown: (state, x, y, device) =>
      pointerDown(state, x, y, device).state,
    pointerMove: (state, x, y, device) =>
      pointerMove(state, x, y, device).state,
    pointerUp: (state, device) => pointerUp(state, device).state,
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
  setBestChain(chainStep: number): void;
  setBestMove(points: number): void;
  continueLevel(): void;
  setSelection(col: number, row: number): void;
  clearSelection(): void;
  setOffer(col: number, row: number): void;
  clearOffer(): void;
  requestSwap(colA: number, rowA: number, colB: number, rowB: number): void;
  pointerDown(x: number, y: number, device?: PointerDevice): void;
  pointerMove(x: number, y: number, device?: PointerDevice): void;
  pointerUp(device?: PointerDevice): void;
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

    setBestChain(chainStep) {
      host.apply((state) => api.setBestChain(state, chainStep));
    },

    setBestMove(points) {
      host.apply((state) => api.setBestMove(state, points));
    },

    continueLevel() {
      host.apply((state) => api.continueLevel(state));
    },

    setSelection(col, row) {
      host.apply((state) => api.setSelection(state, col, row));
    },

    clearSelection() {
      host.apply((state) => api.clearSelection(state));
    },

    setOffer(col, row) {
      host.apply((state) => api.setOffer(state, col, row));
    },

    clearOffer() {
      host.apply((state) => api.clearOffer(state));
    },

    requestSwap(colA, rowA, colB, rowB) {
      host.apply((state) => api.requestSwap(state, colA, rowA, colB, rowB));
    },

    // The three pointer poses take effect the moment they are called, in the
    // state `apply` stores back — no frame need pass between them, so a
    // selection and the swap it leads to are both posed without advancing the
    // game at all (specs/instrumentation.md).
    pointerDown(x, y, device) {
      host.apply((state) => api.pointerDown(state, x, y, device));
    },

    pointerMove(x, y, device) {
      host.apply((state) => api.pointerMove(state, x, y, device));
    },

    pointerUp(device) {
      host.apply((state) => api.pointerUp(state, device));
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
