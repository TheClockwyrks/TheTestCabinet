// Facet — the debug surface as the CASE specifies it, for `simple-2d`.
// CASE-PROVIDED.
//
// specs/instrumentation.md fixes the surface a build's `initialize` returns
// beside its state, as `[state, debug]`, and this module is that specification
// written down as types: the operations, their arguments, the snapshot shape,
// and the version. It is the ONLY description of the surface the validators
// read. The build declares its own type for what it returned; nothing here
// imports it, and the harness reaches the object itself through `engine.debug`
// alone — so a build whose surface departs from the specification is held
// against the specification rather than against its own idea of what it wrote.
//
// HOW THE SURFACE IS SHAPED UNDER THIS ENGINE. The engine holds the state BY
// VALUE and hands it out read-only, so the surface holds no state of its own
// and nothing on it mutates anything. Every operation is written in the shape
// of the game's `update`: a POSE takes the current state and returns the next
// one (`loadBoard(state, rows)`, `requestSwap(state, colA, rowA, colB, rowB)`),
// and a READING takes the current state and returns what it read
// (`snapshot(state)`). A caller drives a pose through
// `engine.apply((s) => debug.loadBoard(s, rows))` and a reading against
// `engine.state`. `harness.ts`'s `Driver` is what turns that into the
// `h.debug.loadBoard(rows)` a check writes.
//
// THE CLOCK IS NOT HERE. Under this engine the frame loop, the keyboard, the
// pointer and the overlay belong to the runtime, so `setAutoStep` and `advance`
// — which the `none` flavor of the specification puts on the surface — are the
// engine's and are absent from REQUIRED_OPS below.
//
// The surface is generic over the build's state type, because this module
// imports nothing of the build: `harness.ts` binds it to the `FacetState` the
// build declared.

import type { DeepReadonly } from "ts-essentials";
import { FACET_DEBUG_VERSION } from "./constants";
import type { Cut, GemKind, PointerDevice, Screen } from "./constants";
import type { CellRef, TargetRect } from "./board";

// Every one of these has ONE home — `constants.ts` derives each union from the
// literal table specs/ fixes it by, and `board.ts` owns the cell reference and
// the target rectangle the four requirements are asked of — and this module
// re-exports rather than redeclaring. Two independent declarations of one union
// drift silently, and a check reaching for a type through the surface must be
// reaching for the same type a check reaching for it through the board gets.
export { FACET_DEBUG_VERSION };
export type { CellRef, Cut, GemKind, PointerDevice, Screen, TargetRect };

/**
 * Where resolution stands, from specs/rules.md: `idle` while the board is
 * settled, `swapping` while an accepted swap is in motion, `resolving` while a
 * chain is running.
 */
export type Phase = "idle" | "swapping" | "resolving";

/** One cell of the board, as a snapshot reports it. */
export interface CellSnapshot {
  col: number;
  row: number;
  /** The cell's center on the stage, derived from specs/board.md's formulas. */
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

/** The board a snapshot reports. Empty while no board is in play. */
export interface BoardSnapshot {
  cols: number;
  rows: number;
  /** Every cell, in reading order from the top-left to the bottom-right. */
  cells: CellSnapshot[];
}

/**
 * The plain, JSON-shaped view `snapshot` returns.
 *
 * The shape is fixed and every field is present on every screen: a field with
 * nothing to report holds its resting value rather than going missing.
 */
export interface FacetSnapshot {
  version: number;
  screen: Screen;
  /** The screen's highlighted menu item, from 0. */
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
  /**
   * The kinds posed for each column's refill, `GRID_COLS` entries: the string
   * `setRefillKinds` posed for that column, and `""` for a column that draws.
   */
  refillKinds: string[];
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
 * The surface a build returns beside its state from `initialize`, over the
 * build's own state type `S`.
 *
 * Each pose is a transition — the current state in, the next state out — and
 * `snapshot` is a reading of the current state. None of them touches the state
 * it was handed: `DeepReadonly<S>` is the view the engine hands out, and the
 * compiler is what says a pose returns a new value rather than mutating.
 */
export interface FacetDebugApi<S = unknown> {
  version: number;
  reset(state: DeepReadonly<S>): S;
  snapshot(state: DeepReadonly<S>): FacetSnapshot;
  setScreen(state: DeepReadonly<S>, screen: Screen): S;
  setMenuIndex(state: DeepReadonly<S>, index: number): S;
  loadBoard(state: DeepReadonly<S>, rows: readonly string[]): S;
  dealBoard(state: DeepReadonly<S>): S;
  clearBoard(state: DeepReadonly<S>): S;
  setGem(state: DeepReadonly<S>, col: number, row: number, token: string): S;
  /**
   * Poses what R9's refill deals into column `col`, letter by letter from the
   * top of the board down; a row past the end of `kinds` draws.
   */
  setRefillKinds(state: DeepReadonly<S>, col: number, kinds: string): S;
  /** Leaves no refill posed on any column, so every refill draws. */
  clearRefillKinds(state: DeepReadonly<S>): S;
  setScore(state: DeepReadonly<S>, points: number): S;
  setLevel(state: DeepReadonly<S>, level: number): S;
  setLevelScore(state: DeepReadonly<S>, points: number): S;
  setBestChain(state: DeepReadonly<S>, chainStep: number): S;
  setBestMove(state: DeepReadonly<S>, points: number): S;
  setMoveScore(state: DeepReadonly<S>, points: number): S;
  setSelection(state: DeepReadonly<S>, col: number, row: number): S;
  clearSelection(state: DeepReadonly<S>): S;
  setOffer(state: DeepReadonly<S>, col: number, row: number): S;
  clearOffer(state: DeepReadonly<S>): S;
  clearRefusal(state: DeepReadonly<S>): S;
  clearChain(state: DeepReadonly<S>): S;
  requestSwap(
    state: DeepReadonly<S>,
    colA: number,
    rowA: number,
    colB: number,
    rowB: number,
  ): S;
  pointerDown(
    state: DeepReadonly<S>,
    x: number,
    y: number,
    device?: PointerDevice,
  ): S;
  pointerMove(
    state: DeepReadonly<S>,
    x: number,
    y: number,
    device?: PointerDevice,
  ): S;
  pointerUp(state: DeepReadonly<S>, device?: PointerDevice): S;
}

/**
 * The operations that READ the state rather than replace it.
 *
 * A driver over the surface needs to know which members to call with the
 * current state and hand back, and which to run through `engine.apply`; the
 * surface's shape alone cannot say at runtime, so the specification names them.
 */
export const READINGS = ["snapshot"] as const;

/**
 * Every operation the surface must carry under this engine.
 *
 * Twenty-six: the twenty-eight of specs/instrumentation.md less `setAutoStep`
 * and `advance`, which are the runtime's here and are not on the surface at all.
 *
 * EVERY ONE OF THEM WRITES ONE ELEMENT OF THE STATE or reads it. Reaching a
 * screen, opening a round, and quitting to the title are sequences of these, and
 * those sequences live in `harness.ts` where all three projects' suites share
 * them.
 */
export const REQUIRED_OPS = [
  "reset",
  "snapshot",
  "setScreen",
  "setMenuIndex",
  "loadBoard",
  "dealBoard",
  "clearBoard",
  "setGem",
  "setRefillKinds",
  "clearRefillKinds",
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
