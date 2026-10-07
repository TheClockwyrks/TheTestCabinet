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
// resolution the player controller feeds, so the target hit test, the hit
// radius, the press, move and release tables, and the acceptance rules all run
// exactly as they do in play, and each call takes effect immediately rather
// than waiting on a frame. Each of the three carries the device that drove it,
// defaulting to `"mouse"`, so a posed touch and a posed mouse differ only in
// what the state reports.
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
// A POSE DOES SHOW ITS EFFECTS, because a scenario that poses a board and then
// looks at it should see the board a player would see. So a pose is folded into
// a one-transition batch and handed to the presentation through exactly the
// path a frame's batch takes: a pose that replaces the board outright — a fresh
// deal, a `loadBoard`, a `reset` — drops whatever is still flying and pours a
// dealt board in from above, and the auras are brought level with the board the
// pose left.
//
// The surface is inert during normal play: nothing below runs until something
// calls it.

import type { World } from "@clockwyrks/structured-2d";
import { assets } from "./assets";
import { Bench } from "./bench";
import { applyCore, toCore } from "./bridge";
import { FACET_DEBUG_VERSION } from "./constants";
import { auraCells } from "./effects";
import { fold, openBatch, showBatch } from "./steps";
import {
  clearBoard,
  clearChain,
  clearOffer,
  clearRefillKinds,
  clearRefusal,
  clearSelection,
  dealBoard,
  loadBoard,
  pointerDown,
  pointerMove,
  pointerUp,
  poseSwap,
  quiet,
  reconcile,
  reset,
  setBestChain,
  setBestMove,
  setGem,
  setLevel,
  setLevelScore,
  setMenuIndex,
  setMoveScore,
  setOffer,
  setRefillKinds,
  setScore,
  setScreen,
  setSelection,
  snapshot,
  type FacetSnapshot,
  type FacetState as CoreState,
  type PointerDevice,
  type Screen,
} from "./core";
import { facetState, type FacetState } from "./game";

export type { FacetSnapshot };

/**
 * The surface. Every pose acts on the live world at the call and returns
 * nothing; the one reading, `snapshot`, returns what it read.
 */
export interface FacetDebugApi {
  version: number;
  reset(): void;
  /**
   * Every reading this surface reports brought into agreement with the game as
   * it stands, advancing nothing.
   */
  reconcile(): void;
  snapshot(): FacetSnapshot;
  setScreen(screen: Screen): void;
  setMenuIndex(index: number): void;
  loadBoard(rows: readonly string[]): void;
  dealBoard(): void;
  clearBoard(): void;
  setGem(col: number, row: number, token: string): void;
  setRefillKinds(col: number, kinds: string): void;
  clearRefillKinds(): void;
  setScore(points: number): void;
  setLevel(level: number): void;
  setLevelScore(points: number): void;
  setBestChain(chainStep: number): void;
  setBestMove(points: number): void;
  setMoveScore(points: number): void;
  setSelection(col: number, row: number): void;
  clearSelection(): void;
  setOffer(col: number, row: number): void;
  clearOffer(): void;
  clearRefusal(): void;
  clearChain(): void;
  requestSwap(colA: number, rowA: number, colB: number, rowB: number): void;
  pointerDown(x: number, y: number, device?: PointerDevice): void;
  pointerMove(x: number, y: number, device?: PointerDevice): void;
  pointerUp(device?: PointerDevice): void;
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
    const batch = fold(openBatch(before), quiet(apply(before)));
    applyCore(state, batch.state);

    const presentation = world().find(Bench)?.presentation;
    if (presentation === undefined) return;
    const store = assets();
    showBatch(presentation, batch, store);
    presentation.syncAuras(auraCells(batch.state.board), store);
  };

  return {
    version: FACET_DEBUG_VERSION,

    /**
     * Every declared field back at its title-screen value. `muted` is
     * deliberately untouched: the engine owns muting, and a reset is not a
     * reason to start making noise again.
     */
    reset() {
      pose((state) => reset(state));
    },

    /**
     * Every reading this surface reports brought into agreement with the game as
     * it stands, without advancing anything.
     *
     * This build works every derived reading out at the read — `src/core/`'s
     * `snapshot` computes a cell's center, the level's target, the multiplier,
     * the longest fall, the step's hold, whether a legal swap exists, and the
     * screen's targets from the state each follows from — so there is nothing
     * held here that a pose can leave behind, and the core call brings back the
     * state it was handed. It is written out rather than left absent because
     * every build owes the operation, and one that kept any of those as a stored
     * copy would rewrite it in exactly this place.
     *
     * NOT THROUGH `pose`, deliberately. A pose shows its effects, and showing is
     * the one thing this must not do: `specs/instrumentation.md` has it fire
     * nothing and advance nothing, so it reaches the state alone and leaves the
     * presentation exactly as the last frame or pose left it.
     */
    reconcile() {
      const state = live();
      applyCore(state, reconcile(toCore(state)));
    },

    /** A pure read of the state. It changes nothing. */
    snapshot() {
      return snapshot(toCore(live()));
    },

    /** The screen shown. Nothing else changes. */
    setScreen(screen) {
      pose((state) => setScreen(state, screen));
    },

    /** The highlighted item on whichever menu the screen shows, from `0`. */
    setMenuIndex(index) {
      pose((state) => setMenuIndex(state, index));
    },

    /**
     * An arbitrary board posed. The notation is validated as it is parsed, and
     * a board posed this way is a board like any other: every gem of it is
     * standing still where it was written, so every cell reports a `fell` of
     * `0`, it rests exactly as it was written until a swap is accepted on it,
     * and the rules govern it unchanged from there. The board is the whole of
     * what it writes.
     */
    loadBoard(rows) {
      pose((state) => loadBoard(state, rows));
    },

    /**
     * A fresh opening board dealt through the game's own code, so it holds no
     * run under R4, carries a legal swap, and comes in from above.
     */
    dealBoard() {
      pose(dealBoard);
    },

    /** No board in play. Nothing else changes. */
    clearBoard() {
      pose(clearBoard);
    },

    /** One cell of the board written; everything else stands. */
    setGem(col, row, token) {
      pose((state) => setGem(state, col, row, token));
    },

    /**
     * What R9's refill deals into one column posed, letter by letter from the
     * top of the board down. The board and every other column's pose stand.
     */
    setRefillKinds(col, kinds) {
      pose((state) => setRefillKinds(state, col, kinds));
    },

    /** No refill posed on any column, so every refill draws as R9 states. */
    clearRefillKinds() {
      pose((state) => clearRefillKinds(state));
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

    /** `bestChain` set, a whole number of at least `0`. */
    setBestChain(chainStep) {
      pose((state) => setBestChain(state, chainStep));
    },

    /** `bestMove` set. `moveScore` is its own figure. */
    setBestMove(points) {
      pose((state) => setBestMove(state, points));
    },

    /** `moveScore` set. `bestMove` is its own figure. */
    setMoveScore(points) {
      pose((state) => setMoveScore(state, points));
    },

    /** A cell made the selection. No swap is requested. */
    setSelection(col, row) {
      pose((state) => setSelection(state, col, row));
    },

    /** Nothing selected. The offer, the board, and the phase stand. */
    clearSelection() {
      pose(clearSelection);
    },

    /**
     * A cell made the one the selected gem is offered into. No swap is
     * requested: a release is what plays an offer (specs/controls.md).
     */
    setOffer(col, row) {
      pose((state) => setOffer(state, col, row));
    },

    /** Nothing offered. The selection, the board, and the phase stand. */
    clearOffer() {
      pose(clearOffer);
    },

    /** No refusal standing, whatever time the standing one had left. */
    clearRefusal() {
      pose(clearRefusal);
    },

    /** Resolution settled: the phase back at `idle` with resting timers. */
    clearChain() {
      pose(clearChain);
    },

    /**
     * A swap posed, through the same acceptance path a player's release takes,
     * so R1, R2, and R3 decide it and nothing is bypassed. It names both cells
     * itself, so the selection and the offer stand where they were either way.
     */
    requestSwap(colA, rowA, colB, rowB) {
      pose((state) => poseSwap(state, colA, rowA, colB, rowB));
    },

    /** A press, resolved immediately through the real input path. */
    pointerDown(x, y, device = "mouse") {
      pose((state) => pointerDown(state, x, y, device).state);
    },

    /** A move, resolved immediately: an offer, a withdrawal, or a highlight. */
    pointerMove(x, y, device = "mouse") {
      pose((state) => pointerMove(state, x, y, device).state);
    },

    /** A release, which is what takes a target and what plays a move. */
    pointerUp(device = "mouse") {
      pose((state) => pointerUp(state, device).state);
    },
  };
}
