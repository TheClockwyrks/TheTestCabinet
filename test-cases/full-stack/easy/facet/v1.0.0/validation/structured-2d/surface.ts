// Facet — the debug surface as the CASE specifies it, structured-2d flavor.
// CASE-PROVIDED.
//
// specs/instrumentation.md fixes the surface the game instance's `initialize`
// builds and returns, which the engine holds and hands back from `engine.debug`.
// This module is that specification written down as types: the operations, their
// arguments, the snapshot shape, and the version. It is the ONLY description of
// the surface the validators read.
//
// Nothing here imports anything of the build. A build declares its own type for
// the surface it returns — the `D` of its `GameInstance<D>` — and that type is
// the build's; what a check holds it to is this file. So a build whose surface
// departs from the specification is held against the specification rather than
// against its own idea of what it wrote.
//
// THE SURFACE IS LIVE UNDER THIS ENGINE. "Each operation acts on the live game at
// the moment it is called. A pose takes only the parameters its heading names,
// arranges the running game through the same systems play uses, and returns
// nothing; a reading returns plain data built at the call and changes nothing."
// So a check writes `h.debug.loadBoard(rows)` and the board is posed when the
// call returns — no wrapper, no frame, no await. That is the one thing that
// differs from the `simple-2d` copy of this file, where the same operations are
// pure functions of a state held by value.
//
// TWO OPERATIONS ARE NOT HERE, AND THAT IS THE SPECIFICATION. Under `none` the
// surface carries `setAutoStep` and `advance`, because the build owns its own
// frame loop. Under an engine "the clock, the keyboard, the pointer, and the
// overlay belong to the Structured 2D engine ... and the surface carries no
// operation for any of them", so the suite drives frames with `engine.advance`
// and the surface carries twenty-three operations rather than twenty-five.

import {
  DEFAULT_SEED,
  FACET_DEBUG_VERSION,
  type Cut,
  type GemKind,
  type PointerDevice,
  type Screen,
} from "./constants";
import type { CellRef, TargetRect } from "./board";

/**
 * The figures and the unions this file describes the surface in terms of have
 * ONE home each, and it is not here.
 *
 * `constants.ts` derives `GemKind`, `Cut`, `Screen` and `PointerDevice` from the
 * literal tables specs/board.md, specs/ui.md and specs/controls.md fix, and
 * holds the version and the default seed beside every other figure the
 * specification states; `board.ts` declares the cell address every fixture and
 * every geometry helper already speaks in, and the target rectangle its four
 * requirements are asked of. They are re-exported rather than restated because a
 * second declaration of a union drifts from the first in silence, and this file
 * and those two are read together on every check.
 */
export { DEFAULT_SEED, FACET_DEBUG_VERSION };
export type { CellRef, Cut, GemKind, PointerDevice, Screen, TargetRect };

/**
 * Where resolution stands: `idle` while settled, `swapping` while an accepted
 * swap is in motion, `resolving` while chaining.
 */
export type Phase = "idle" | "swapping" | "resolving";

/** One cell of the board, as the snapshot reports it. */
export interface CellSnapshot {
  col: number;
  row: number;
  /** The cell center on the stage, from the formulas in specs/board.md. */
  x: number;
  y: number;
  /** The gem's kind, and `null` for a prism. */
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

/** The board, `{ cols: 0, rows: 0, cells: [] }` while none is in play. */
export interface BoardSnapshot {
  cols: number;
  rows: number;
  /** Every cell in reading order, top-left to bottom-right. */
  cells: CellSnapshot[];
}

/**
 * The plain, JSON-shaped view `snapshot()` returns.
 *
 * The shape is FIXED and every field is present on every screen: a field with
 * nothing to report holds its resting value rather than going missing.
 */
export interface FacetSnapshot {
  version: number;
  screen: Screen;
  /** The highlighted menu item, from 0. Live on every screen carrying a menu. */
  menuIndex: number;
  score: number;
  /** The level being played, counted from 1. */
  level: number;
  /** Banked toward the current level. */
  levelScore: number;
  /** `LEVEL_TARGET_STEP * level`, derived. */
  levelTarget: number;
  phase: Phase;
  /** The step being resolved, from 1, and 0 while idle. */
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
  /** Whether any legal swap exists, derived from R1 and R3 over the board. */
  legalSwap: boolean;
  rngState: number;
  pointer: { x: number; y: number; down: boolean; device: PointerDevice };
  /** The id of the target the held press armed, or `null`. */
  armedTarget: string | null;
  /**
   * The current screen's pointer targets, under the ids and in the order
   * specs/controls.md fixes for that screen. A target's rectangle is the one the
   * game hit-tests against, so pressing at a listed target's center takes it,
   * and `board.ts`'s `targetFault` is what holds the set to the four
   * requirements that file states.
   */
  targets: TargetRect[];
  muted: boolean;
  /** Accumulated simulation time, in seconds. */
  simTime: number;
}

/**
 * The surface the game instance's `initialize` returns.
 *
 * Every pose takes only the parameters its heading in specs/instrumentation.md
 * names and returns nothing; `snapshot` is the one reading.
 */
export interface FacetDebugApi {
  version: number;

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

  /** Poses an arbitrary board, in the notation specs/board.md defines. */
  loadBoard(rows: readonly string[]): void;
  /** Deals a fresh opening board through the game's own code, from `rngState`. */
  dealBoard(): void;
  /** Leaves no board in play. */
  clearBoard(): void;
  /** Writes one cell of the board from a single cell token. */
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
   * `device`, which defaults to `"mouse"`. Each is resolved against the live
   * state before the call returns, so a selection and the swap it leads to are
   * both posed without a frame passing between them.
   */
  pointerDown(x: number, y: number, device?: PointerDevice): void;
  pointerMove(x: number, y: number, device?: PointerDevice): void;
  pointerUp(device?: PointerDevice): void;
}

/**
 * The operations that READ the running game rather than pose it.
 *
 * The surface's shape alone cannot say at runtime which members return a value
 * and which arrange the game, so the specification names them: a check that
 * sweeps the surface calls a reading for its value and a pose for its effect.
 */
export const READINGS = ["snapshot"] as const;

/**
 * Every operation the surface must carry under this engine.
 *
 * Twenty-five, not twenty-seven: `setAutoStep` and `advance` exist under `none`
 * alone, because here the clock is the engine's.
 *
 * EVERY ONE OF THEM WRITES ONE ELEMENT OF THE STATE, reads it, or brings the
 * readings into agreement with it. Reaching a
 * screen, opening a round, and quitting to the title are sequences of these, and
 * those sequences live in `harness.ts` where all three projects' suites share
 * them.
 */
export const REQUIRED_OPS = [
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
