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

import { CUTS, DEFAULT_SEED, GEM_KINDS } from "../constants";

/** One of the seven kinds in `GEM_KINDS` (specs/board.md). */
export type GemKind = (typeof GEM_KINDS)[number];

/** One of the four cuts in `CUTS` (specs/board.md). */
export type Cut = (typeof CUTS)[number];

/** The screens in `specs/ui.md`. */
export type Screen =
  "title" | "howto" | "playing" | "paused" | "levelclear" | "gameover";

/**
 * Where resolution stands (specs/rules.md, `## A chain step`): the board is
 * settled, an accepted swap is travelling between its two cells, or a chain is
 * running over the board.
 */
export type Phase = "idle" | "swapping" | "resolving";

/** What drove the pointer. A mouse, a pen, and a finger all reach one path. */
export type PointerDevice = "mouse" | "pen" | "touch";

/**
 * One gem. `kind` is `null` exactly when `cut` is `"prism"`, because a prism
 * carries no kind and therefore joins no run under R4.
 */
export interface Gem {
  readonly kind: GemKind | null;
  readonly cut: Cut;
  /** A whole number `0..MAX_STRAIN`; `MAX_STRAIN` is flawed. */
  readonly strain: number;
  /**
   * How many rows the gem traveled to reach the cell it holds, as R9 fixes
   * it: `0` for a gem that was already standing here, the rows it dropped for
   * a survivor, and at least `row + 1` for a gem dealt in from above. It is
   * what times the fall a renderer draws, and it is read back as the board's
   * `lastFall`.
   */
  readonly fell: number;
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
  readonly device: PointerDevice;
}

/**
 * The whole of the game's state.
 *
 * Beyond the fields `specs/state.md` names, one is bookkeeping the rules need
 * and the snapshot does not report: `chainSwap`, which R5 reads to seed a prism
 * chain and R8 reads to place a created gem at the cell the chain's swap
 * exchanged. The hold a pointer is being read from needs no field of its own,
 * because `selection` is the gem being held and `offer` is where it is being
 * offered, and both of those the player can see.
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

  /** Where resolution stands. `chainStep` is `0` while `phase` is not `resolving`. */
  readonly phase: Phase;
  readonly chainStep: number;
  /** The game time in the swap in motion; `0` while `phase` is not `swapping`. */
  readonly swapTimer: number;
  /** The game time in the step in progress; `0` while `phase` is not `resolving`. */
  readonly stepTimer: number;
  /** The swap that began the running chain; `null` while `phase` is `idle`. */
  readonly chainSwap: CellPair | null;

  /** What the most recent chain step did. `lastFall` is read off the board. */
  readonly lastCleared: number;
  readonly lastPoints: number;
  readonly lastWaves: number;

  /** What the current level has been worth (specs/rules.md). */
  readonly moveScore: number;
  readonly bestMove: number;
  readonly bestChain: number;

  /** The gem being held, the cell it is offered into, and a refusal. */
  readonly selection: Cell | null;
  readonly offer: Cell | null;
  readonly refusal: CellPair | null;
  /** The game time the standing refusal has stood for. */
  readonly refusalTimer: number;

  /** The pointer, and the id of the target the held press armed. */
  readonly pointer: PointerState;
  readonly armedTarget: string | null;

  /** The runtime's mute bit, mirrored, and the accumulated simulation time. */
  readonly muted: boolean;
  readonly simTime: number;

  /** The whole state of the seeded generator (specs/instrumentation.md). */
  readonly rngState: number;
}

/** No board in play, which is what the snapshot reports off every menu. */
export const EMPTY_BOARD: BoardState = { cols: 0, rows: 0, gems: [] };

/**
 * The nine events one frame can raise, which `specs/ui.md` maps to the nine
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
  readonly land: boolean;
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
  land: false,
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
    land: a.land || b.land,
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
    swapTimer: 0,
    stepTimer: 0,
    chainSwap: null,
    lastCleared: 0,
    lastPoints: 0,
    lastWaves: 0,
    moveScore: 0,
    bestMove: 0,
    bestChain: 0,
    selection: null,
    offer: null,
    refusal: null,
    refusalTimer: 0,
    pointer: { x: 0, y: 0, down: false, device: "mouse" },
    armedTarget: null,
    muted: false,
    simTime: 0,
    rngState: seed,
  };
}
