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

import { HANDLE, type Cut, type GemKind, type Screen } from "./constants";
import type { CellRef } from "./board";

/** The global an engineless build installs its surface on. */
export const FACET_HANDLE = HANDLE;

// ONE HOME PER TYPE, and this file is not it. `constants.ts` derives the unions
// from the literal tables the specification fixes (`type GemKind =
// (typeof GEM_KINDS)[number]`) and `board.ts` states the cell reference the
// notation is written in, so a check reads the same union whichever module it
// imported from and two declarations cannot drift apart.
export { FACET_DEBUG_VERSION, DEFAULT_SEED } from "./constants";
export type { Cut, GemKind, Screen } from "./constants";
export type { CellRef } from "./board";

/** Where resolution stands, as `specs/rules.md` fixes it. */
export type Phase = "idle" | "resolving";

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
  /** Game time accumulated toward the next step. */
  stepTimer: number;
  board: BoardSnapshot;
  cursor: CellRef;
  selection: CellRef | null;
  refusal: { a: CellRef; b: CellRef } | null;
  /** Cells cleared by the most recent chain step. */
  lastCleared: number;
  /** Points the most recent chain step scored. */
  lastPoints: number;
  /** Whether any legal swap exists, derived from R1 and R3. */
  legalSwap: boolean;
  rngState: number;
  pointer: { x: number; y: number; down: boolean };
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
  /** A pure read of the state. */
  snapshot(): FacetSnapshot;

  /** Poses the choice of `PLAY`, which is what `PLAY AGAIN` also chooses. */
  start(): void;
  /** Poses the choice of `HOW TO PLAY`. */
  openHowTo(): void;
  /** Poses the `pause` action from `playing`. */
  pause(): void;
  /** Poses the choice of `RESUME`. */
  resume(): void;
  /** Poses the choice of `QUIT`. */
  quit(): void;

  /** Poses an arbitrary board, written in `specs/board.md`'s notation. */
  loadBoard(rows: readonly string[]): void;
  /** Writes one cell of the board. */
  setGem(col: number, row: number, token: string): void;

  setScore(points: number): void;
  setLevel(level: number): void;
  setLevelScore(points: number): void;

  setCursor(col: number, row: number): void;
  setSelection(col: number, row: number): void;
  clearSelection(): void;

  /** Requests a swap through the same acceptance path a player's swap takes. */
  requestSwap(colA: number, rowA: number, colB: number, rowB: number): void;

  pointerDown(x: number, y: number): void;
  pointerMove(x: number, y: number): void;
  pointerUp(): void;
}

/**
 * Every operation `specs/instrumentation.md` requires on the surface under this
 * engine.
 *
 * Twenty-one names: the nineteen every engine's surface carries, plus the two
 * clock operations that exist only here because nothing outside an engineless
 * build owns its loop.
 */
export const REQUIRED_OPS = [
  "setAutoStep",
  "advance",
  "reset",
  "snapshot",
  "start",
  "openHowTo",
  "pause",
  "resume",
  "quit",
  "loadBoard",
  "setGem",
  "setScore",
  "setLevel",
  "setLevelScore",
  "setCursor",
  "setSelection",
  "clearSelection",
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
