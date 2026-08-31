// Facet — the shape of the game's state, and its resting values.
//
// `specs/state.md` lists what the state carries and leaves its organization to
// the build; `specs/instrumentation.md` fixes the one contract over it, which
// is that every field the debug surface reads or poses is here to be read and
// posed. This module declares that shape and nothing else: no rule is applied
// here, and nothing in this file reaches for a clock, a canvas, or a DOM.
//
// EVERY FIELD IS `readonly`, on purpose. A frame is a transition — the next
// state built from the current one — rather than a mutation, which is what the
// `structured-2d` and `simple-2d` engines require of `update` and what makes a
// posed scenario reproduce exactly. The core is written that way for all three
// builds so there is one implementation, not three.

import {
  CURSOR_START_COL,
  CURSOR_START_ROW,
  CUTS,
  DEFAULT_SEED,
  GEM_KINDS,
} from "../constants";

/** One of the seven kinds in `GEM_KINDS` (specs/board.md). */
export type GemKind = (typeof GEM_KINDS)[number];

/** One of the four cuts in `CUTS` (specs/board.md). */
export type Cut = (typeof CUTS)[number];

/** The screens in `specs/ui.md`. */
export type Screen = "title" | "howto" | "playing" | "paused" | "gameover";

/** Where resolution stands (specs/rules.md, `## A chain step`). */
export type Phase = "idle" | "resolving";

/**
 * One gem. `kind` is `null` exactly when `cut` is `"prism"`, because a prism
 * carries no kind and therefore joins no run under R4.
 */
export interface Gem {
  readonly kind: GemKind | null;
  readonly cut: Cut;
  /** A whole number `0..MAX_STRAIN`; `MAX_STRAIN` is flawed. */
  readonly strain: number;
}

/** A cell address, zero-indexed from the top-left (specs/board.md). */
export interface Cell {
  readonly col: number;
  readonly row: number;
}

/**
 * The board. `gems` is row-major, `row * cols + col`, and a slot is `null` only
 * between R9's removal and its settling, which happens inside one chain step;
 * a settled board holds a gem in every cell.
 */
export interface BoardState {
  readonly cols: number;
  readonly rows: number;
  readonly gems: readonly (Gem | null)[];
}

/** The two cells a swap named. */
export interface CellPair {
  readonly a: Cell;
  readonly b: Cell;
}

/** The pointer as the runtime reports it, in logical stage units. */
export interface PointerState {
  readonly x: number;
  readonly y: number;
  readonly down: boolean;
}

/**
 * The whole of the game's state.
 *
 * Beyond the fields `specs/state.md` names, three are bookkeeping the rules
 * need and the snapshot does not report: `chainSwap`, which R8 reads to place
 * a created gem at the cell the chain's swap exchanged; and `pressedCell` with
 * `dragSwapped`, which carry the drag `specs/controls.md` describes across the
 * frames of one hold.
 */
export interface FacetState {
  /** The screen being shown, and the menu item highlighted on it, from `0`. */
  readonly screen: Screen;
  readonly menuIndex: number;

  /** The board being played; `EMPTY_BOARD` while none is. */
  readonly board: BoardState;

  /** The round's figures. The level target is derived, not stored. */
  readonly score: number;
  readonly level: number;
  readonly levelScore: number;

  /** Where resolution stands. `chainStep` is `0` while `phase` is `idle`. */
  readonly phase: Phase;
  readonly chainStep: number;
  readonly stepTimer: number;
  /** The swap that began the running chain; `null` while `phase` is `idle`. */
  readonly chainSwap: CellPair | null;

  /** What the most recent chain step did. */
  readonly lastCleared: number;
  readonly lastPoints: number;

  /** The keyboard cursor, the selection, and a standing refusal. */
  readonly cursor: Cell;
  readonly selection: Cell | null;
  readonly refusal: CellPair | null;
  /** The game time the standing refusal has stood for. */
  readonly refusalTimer: number;

  /** The pointer, and the hold a drag is being read from. */
  readonly pointer: PointerState;
  readonly pressedCell: Cell | null;
  readonly dragSwapped: boolean;

  /** The runtime's mute bit, mirrored, and the accumulated simulation time. */
  readonly muted: boolean;
  readonly simTime: number;

  /** The whole state of the seeded generator (specs/instrumentation.md). */
  readonly rngState: number;
}

/** No board in play, which is what the snapshot reports off every menu. */
export const EMPTY_BOARD: BoardState = { cols: 0, rows: 0, gems: [] };

/**
 * The eight events one frame can raise, which `specs/ui.md` maps to the eight
 * cues in `CUES`. The core reports them rather than playing them, because
 * audio belongs to the runtime layer and because "a cue is played by a frame,
 * never by a pose of the debug surface" — a pose discards this record.
 *
 * Each is a flag rather than a count, since a frame plays each cue at most
 * once however many times its event happened on that frame.
 */
export interface FacetEvents {
  readonly select: boolean;
  readonly swap: boolean;
  readonly refuse: boolean;
  readonly clear: boolean;
  readonly flaw: boolean;
  readonly cut: boolean;
  readonly levelUp: boolean;
  readonly gameOver: boolean;
}

/** A frame that raised nothing. */
export const NO_EVENTS: FacetEvents = {
  select: false,
  swap: false,
  refuse: false,
  clear: false,
  flaw: false,
  cut: false,
  levelUp: false,
  gameOver: false,
};

/** A state and the events producing it raised, which is what a step returns. */
export interface Stepped {
  readonly state: FacetState;
  readonly events: FacetEvents;
}

/** Both frames' events, so a frame that raises two cues plays each once. */
export function mergeEvents(a: FacetEvents, b: FacetEvents): FacetEvents {
  return {
    select: a.select || b.select,
    swap: a.swap || b.swap,
    refuse: a.refuse || b.refuse,
    clear: a.clear || b.clear,
    flaw: a.flaw || b.flaw,
    cut: a.cut || b.cut,
    levelUp: a.levelUp || b.levelUp,
    gameOver: a.gameOver || b.gameOver,
  };
}

/** `{ state, events }` from a state that raised nothing. */
export function quiet(state: FacetState): Stepped {
  return { state, events: NO_EVENTS };
}

/**
 * The title-screen state, which is where the game opens and what the debug
 * surface's `reset` restores. `muted` is the runtime's, so `reset` carries the
 * caller's bit over this one rather than taking the `false` here.
 */
export function createInitialState(seed: number = DEFAULT_SEED): FacetState {
  return {
    screen: "title",
    menuIndex: 0,
    board: EMPTY_BOARD,
    score: 0,
    level: 1,
    levelScore: 0,
    phase: "idle",
    chainStep: 0,
    stepTimer: 0,
    chainSwap: null,
    lastCleared: 0,
    lastPoints: 0,
    cursor: { col: CURSOR_START_COL, row: CURSOR_START_ROW },
    selection: null,
    refusal: null,
    refusalTimer: 0,
    pointer: { x: 0, y: 0, down: false },
    pressedCell: null,
    dragSwapped: false,
    muted: false,
    simTime: 0,
    rngState: seed,
  };
}
