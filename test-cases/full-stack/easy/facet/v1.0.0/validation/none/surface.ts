// Facet — the debug and automation surface, as a type. CASE-PROVIDED.
//
// `specs/instrumentation.md` is what a build implements; this file is that same
// document written as types, and it is the ONLY description of the surface the
// checks in this project read. Nothing here imports anything of the build: a
// build is held to the surface the specification fixed, never to whatever shape
// its own modules happen to declare.
//
// THIS IS THE `none` FLAVOR. An engineless build owns its frame loop, so nothing
// outside it can take the game off real time — which is why the specification
// puts the clock ON the surface here, as `setAutoStep` and `advance`. Under the
// two engines those two belong to the engine and are absent from the surface, and
// each engine's copy of this file states its own {@link REQUIRED_OPS} for exactly
// that reason.
//
// EVERY OPERATION CROSSES INTO A PAGE. The surface a check drives is a real
// global on a real document, so the harness exposes it as a Proxy whose every
// member returns a promise. The shape below is the surface as the BUILD installs
// it, synchronous; `harness.ts` states the awaited reading of it.

import {
  HANDLE,
  type Cut,
  type GemKind,
  type PointerDevice,
  type Screen,
} from "./constants";
import type { CellRef, TargetRect } from "./board";

/** The global an engineless build installs its surface on. */
export const FACET_HANDLE = HANDLE;

// ONE HOME PER TYPE, and this file is not it. `constants.ts` derives the unions
// from the literal tables the specification fixes (`type GemKind =
// (typeof GEM_KINDS)[number]`) and `board.ts` states the cell reference the
// notation is written in and the target rectangle the four requirements are
// asked of, so a check reads the same type whichever module it imported from and
// two declarations cannot drift apart.
export { FACET_DEBUG_VERSION, DEFAULT_SEED } from "./constants";
export type { Cut, GemKind, PointerDevice, Screen } from "./constants";
export type { CellRef, TargetRect } from "./board";

/**
 * Where resolution stands, as `specs/rules.md` fixes it: `idle` while the board
 * is settled, `swapping` while an accepted swap is in motion, `resolving` while
 * a chain is running.
 */
export type Phase = "idle" | "swapping" | "resolving";

/** One cell of the board, as a snapshot reports it. */
export interface CellSnapshot {
  col: number;
  row: number;
  /** The cell's center on the stage, from the formulas in `specs/board.md`. */
  x: number;
  y: number;
  /** `null` for a prism, which carries no kind. */
  kind: GemKind | null;
  cut: Cut;
  strain: number;
  /**
   * How many rows the gem traveled to reach this cell, under R9. Exact for a
   * gem that survived a step, and at least `row + 1` for one the refill dealt,
   * which is why `board.ts` expresses the second as a floor.
   */
  fell: number;
}

/** The board a snapshot reports, in reading order from the top-left cell. */
export interface BoardSnapshot {
  cols: number;
  rows: number;
  cells: CellSnapshot[];
}

/**
 * The fixed shape `snapshot()` returns.
 *
 * Every field is present on every screen, and a field with nothing to report
 * holds its resting value rather than going missing — which is what lets a check
 * about a screen with no board in play read `board` at all.
 */
export interface FacetSnapshot {
  version: number;
  screen: Screen;
  /** The highlighted item of whichever menu the screen shows, from 0. */
  menuIndex: number;
  score: number;
  /** The level being played, counted from 1. */
  level: number;
  /** Banked toward the current level. */
  levelScore: number;
  /** `LEVEL_TARGET_STEP * level`, derived. */
  levelTarget: number;
  phase: Phase;
  /** 0 while idle. */
  chainStep: number;
  /** `min(chainStep, MAX_MULTIPLIER)`, derived. */
  multiplier: number;
  /** Game time accumulated into the swap in motion. 0 while not swapping. */
  swapTimer: number;
  /** Game time accumulated into the step in progress. 0 while not resolving. */
  stepTimer: number;
  /**
   * How long the step in progress holds, derived:
   * `lastWaves * WAVE_SECONDS + lastFall * FALL_SECONDS_PER_ROW + STEP_SECONDS`,
   * which is `board.ts`'s `stepHold`.
   */
  stepHold: number;
  board: BoardSnapshot;
  /** The gem the player has hold of. */
  selection: CellRef | null;
  /** The neighbor the selected gem is offered into; a release plays it. */
  offer: CellRef | null;
  refusal: { a: CellRef; b: CellRef } | null;
  /** Cells cleared by the most recent chain step. */
  lastCleared: number;
  /** Points the most recent chain step scored. */
  lastPoints: number;
  /** The greatest wave R6 gave that step's clear set. */
  lastWaves: number;
  /** The greatest `fell` on the board, derived. */
  lastFall: number;
  /** Points the move currently running has scored. */
  moveScore: number;
  /** The most points one move has scored in the current level. */
  bestMove: number;
  /** The deepest chain step the current level has reached. */
  bestChain: number;
  /** Whether any legal swap exists, derived from R1 and R3. */
  legalSwap: boolean;
  rngState: number;
  pointer: { x: number; y: number; down: boolean; device: PointerDevice };
  /** The id of the target the held press armed, or `null`. */
  armedTarget: string | null;
  /**
   * The current screen's pointer targets, under the ids and in the order
   * `specs/controls.md` fixes for that screen. A target's rectangle is the one
   * the game hit-tests against, so pressing at a listed target's center takes
   * it, and `board.ts`'s `targetFault` is what holds the set to the four
   * requirements that file states.
   */
  targets: TargetRect[];
  muted: boolean;
  /** Accumulated simulation time, in seconds. */
  simTime: number;
}

/**
 * The surface as the build installs it on `window.__facet`.
 *
 * Every operation is a pose except `snapshot`, which is the one reading and
 * changes nothing.
 */
export interface FacetWindowApi {
  version: number;

  /** Takes the game off real time, and gives it back. */
  setAutoStep(enabled: boolean): void;
  /** Runs `frames` whole frames covering `seconds` of game time. */
  advance(seconds: number, frames?: number): void;

  /** Restores every declared field to its title-screen value. */
  reset(options?: { seed?: number }): void;
  /**
   * Every reading the surface reports brought into agreement with the game as it
   * stands, without advancing anything. A build that works its readings out at
   * the read has nothing to do and this changes nothing.
   */
  reconcile(): void;
  /** A pure read of the state. */
  snapshot(): FacetSnapshot;

  /** Shows one screen. Nothing else changes. */
  setScreen(screen: Screen): void;
  /** Highlights the menu item at `index` on whichever menu the screen shows. */
  setMenuIndex(index: number): void;

  /** Poses an arbitrary board, written in `specs/board.md`'s notation. */
  loadBoard(rows: readonly string[]): void;
  /** Deals a fresh opening board through the game's own code, from `rngState`. */
  dealBoard(): void;
  /** Leaves no board in play. */
  clearBoard(): void;
  /** Writes one cell of the board. */
  setGem(col: number, row: number, token: string): void;

  setScore(points: number): void;
  setLevel(level: number): void;
  setLevelScore(points: number): void;
  setBestChain(chainStep: number): void;
  setBestMove(points: number): void;
  setMoveScore(points: number): void;

  setSelection(col: number, row: number): void;
  clearSelection(): void;
  /** Offers the selected gem into `(col, row)`. No swap is requested. */
  setOffer(col: number, row: number): void;
  clearOffer(): void;
  /** Leaves no refusal standing. */
  clearRefusal(): void;
  /** Settles resolution: `phase` `idle`, the board as the dropped step found it. */
  clearChain(): void;

  /** Requests a swap through the same acceptance path a player's swap takes. */
  requestSwap(colA: number, rowA: number, colB: number, rowB: number): void;

  /**
   * Report a press, a move, and a release at a logical stage position, from
   * `device`, which defaults to `"mouse"`. Each takes effect at the call rather
   * than at the next update, so a selection and the swap it leads to are both
   * posed without a frame passing between them.
   */
  pointerDown(x: number, y: number, device?: PointerDevice): void;
  pointerMove(x: number, y: number, device?: PointerDevice): void;
  pointerUp(device?: PointerDevice): void;
}

/**
 * Every operation `specs/instrumentation.md` requires on the surface under this
 * engine.
 *
 * Twenty-seven names, in the order the specification introduces them: the
 * twenty-five every engine's surface carries, plus the two clock operations that
 * exist only here because nothing outside an engineless build owns its loop.
 *
 * EVERY ONE OF THEM WRITES ONE ELEMENT OF THE STATE, reads it, brings the
 * readings into agreement with it, or moves the clock. Reaching a screen,
 * opening a round, and quitting to the title are
 * sequences of these, and those sequences live in `harness.ts` where all three
 * projects' suites share them.
 */
export const REQUIRED_OPS = [
  "setAutoStep",
  "advance",
  "reset",
  "reconcile",
  "snapshot",
  "setScreen",
  "setMenuIndex",
  "loadBoard",
  "dealBoard",
  "clearBoard",
  "setGem",
  "setScore",
  "setLevel",
  "setLevelScore",
  "setBestChain",
  "setBestMove",
  "setMoveScore",
  "setSelection",
  "clearSelection",
  "setOffer",
  "clearOffer",
  "clearRefusal",
  "clearChain",
  "requestSwap",
  "pointerDown",
  "pointerMove",
  "pointerUp",
] as const;

/**
 * The operations that only READ.
 *
 * Nothing under this engine needs the distinction — every member crosses into
 * the page the same way — but the two engine-backed copies of this file do, since
 * a pure surface cannot be told apart from a reading by its shape at runtime. It
 * is stated here too so the three files answer the same questions.
 */
export const READINGS = ["snapshot"] as const;
