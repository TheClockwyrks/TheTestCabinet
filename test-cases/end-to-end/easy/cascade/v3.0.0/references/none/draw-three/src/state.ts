// Cascade — the game's whole state, and the two ways it is put back to zero.
//
// specs/state.md lists what the state carries and leaves its shape to the build.
// One value holds all of it: the frame loop advances this object and the debug
// surface reads and poses this object, so there is exactly one place a fact about
// the game lives (specs/overview.md).
//
// Three fields are worth naming here because they are counted rather than
// derived, and specs/instrumentation.md is explicit about each:
//
//   * `launched` is raised by one each time the cascade launches a card. It is
//     NOT fifty-two less the cards on the foundations: a posed flyer on a cleared
//     table would read fifty-two under that identity and every posed cascade
//     check would be reading a contradiction.
//   * `cascadeDone` is the cascade's own end flag, set when every card has
//     launched and none is in flight. Posed flyers retiring on a cleared table do
//     not set it.
//   * `trailStamps` counts the stamps the painted layer has taken since it was
//     last cleared, so `clearTrail`, `setTrailPainting`, `deal()` and `reset` are
//     all verifiable by setting a value and reading it back.

import type { Card } from "./cards";
import {
  FOUNDATION_COUNT,
  TABLEAU_COLUMNS,
  type CueName,
  type Suit,
} from "./constants";
import { TrailLayer, type LayerFactory } from "./trail";

/** The four screens the game moves between (specs/screens.md). */
export type Screen = "title" | "howto" | "playing" | "won";

/** The four kinds of pile a card operation may name. */
export type PileKind = "stock" | "waste" | "foundation" | "tableau";

/** The pile kinds a run may be lifted from. The stock offers nothing to lift. */
export type SourceKind = "waste" | "foundation" | "tableau";

/** The pile kinds a run may land on. */
export type TargetKind = "foundation" | "tableau";

/** One card in flight during the victory cascade. */
export interface Flyer {
  id: number;
  suit: Suit;
  rank: number;
  /** The card's top-left on the logical stage. */
  x: number;
  y: number;
  /** Logical units per second. */
  vx: number;
  vy: number;
}

/** The run currently in hand. */
export interface DragState {
  /** In order from the grabbed card, which is the run's leading card. */
  cards: Card[];
  fromPile: SourceKind;
  fromIndex: number;
  /** The top-left of the leading card. */
  x: number;
  y: number;
  /** The press point's offset from the leading card's top-left, held for the
   * length of the gesture so the run travels exactly as far as the pointer. */
  grabDx: number;
  grabDy: number;
}

/** A pile a held run would land on. */
export interface PileRef {
  pile: TargetKind;
  index: number;
}

/** Where and when the most recent press landed. */
export interface PressRecord {
  x: number;
  y: number;
  /** The `simTime` the press arrived at. */
  at: number;
}

/** Everything the game is. */
export interface CascadeState {
  screen: Screen;
  /** The selected item on the menu the current screen shows. */
  menuIndex: number;
  /** The title menu's remembered selection: the entry last activated there. */
  titleIndex: number;

  // The thirteen piles, each ordered from its bottom card to its top card.
  stock: Card[];
  waste: Card[];
  /** Cards on each turned set, oldest set first (specs/stock.md). */
  wasteSets: number[];
  foundations: Card[][];
  tableau: Card[][];

  // The pointer and the hand.
  drag: DragState | null;
  dropTarget: PileRef | null;
  pointer: { x: number; y: number; down: boolean };
  lastPress: PressRecord | null;
  /**
   * Whether the gesture in progress has already had its effect.
   *
   * A double click sends a card home on the PRESS, and the release that follows
   * changes nothing (specs/controls.md). This is how the release knows.
   */
  gestureSpent: boolean;

  // The four faculty gates (specs/instrumentation.md).
  autoFlip: boolean;
  winDetect: boolean;
  launching: boolean;
  trailPainting: boolean;

  // The victory cascade.
  launchClock: number;
  launched: number;
  /** The foundation the next launch tries first, cycling 0, 1, 2, 3. */
  launchCursor: number;
  flyers: Flyer[];
  cascadeDone: boolean;

  // The painted layer, and the stamps it has taken since it was cleared.
  trail: TrailLayer;
  trailStamps: number;

  // The rest.
  simTime: number;
  /** The game's copy of the runtime's mute bit, refreshed in every update. */
  muted: boolean;
  /** The identity the next card or flyer takes. */
  nextId: number;
  /** The cues this frame has raised, played once each at the end of it. */
  pendingCues: Set<CueName>;
}

/** An array of `count` empty piles. */
function emptyPiles(count: number): Card[][] {
  return Array.from({ length: count }, () => []);
}

/**
 * The whole state, at its title-screen values.
 *
 * The painted layer is made once and kept for the life of the state: it is a
 * surface rather than a value, so `reset` and a new deal CLEAR it rather than
 * replacing it.
 */
export function createState(make?: LayerFactory): CascadeState {
  return {
    screen: "title",
    menuIndex: 0,
    titleIndex: 0,
    stock: [],
    waste: [],
    wasteSets: [],
    foundations: emptyPiles(FOUNDATION_COUNT),
    tableau: emptyPiles(TABLEAU_COLUMNS),
    drag: null,
    dropTarget: null,
    pointer: { x: 0, y: 0, down: false },
    lastPress: null,
    gestureSpent: false,
    autoFlip: true,
    winDetect: true,
    launching: true,
    trailPainting: true,
    launchClock: 0,
    launched: 0,
    launchCursor: 0,
    flyers: [],
    cascadeDone: false,
    trail: new TrailLayer(make),
    trailStamps: 0,
    simTime: 0,
    muted: false,
    nextId: 1,
    pendingCues: new Set(),
  };
}

/**
 * Restore every declared field to its title-screen value.
 *
 * `muted` is deliberately untouched: muting is a player preference the runtime
 * owns, and a reset is not a reason to start making noise again
 * (specs/instrumentation.md).
 */
export function resetState(state: CascadeState): void {
  state.screen = "title";
  state.menuIndex = 0;
  state.titleIndex = 0;
  clearTable(state);
  state.drag = null;
  state.dropTarget = null;
  state.pointer = { x: 0, y: 0, down: false };
  state.lastPress = null;
  state.gestureSpent = false;
  state.autoFlip = true;
  state.winDetect = true;
  state.launching = true;
  state.trailPainting = true;
  state.launchClock = 0;
  state.launched = 0;
  state.launchCursor = 0;
  state.flyers = [];
  state.cascadeDone = false;
  clearTrail(state);
  state.simTime = 0;
  state.pendingCues.clear();
}

/** Empty all thirteen piles and the waste's set memory, and nothing else. */
export function clearTable(state: CascadeState): void {
  state.stock = [];
  state.waste = [];
  state.wasteSets = [];
  state.foundations = emptyPiles(FOUNDATION_COUNT);
  state.tableau = emptyPiles(TABLEAU_COLUMNS);
}

/** Wipe the painted layer and zero its stamp count. */
export function clearTrail(state: CascadeState): void {
  state.trail.clear();
  state.trailStamps = 0;
}

/** The identity the next card or flyer takes. */
export function takeId(state: CascadeState): number {
  const id = state.nextId;
  state.nextId += 1;
  return id;
}

/**
 * The pile a `(kind, index)` pair names, or `null` when the pair names none.
 *
 * The stock and the waste ignore their index, which specs/instrumentation.md
 * fixes at `0`; a foundation index runs `0..3` and a column index `0..6`.
 */
export function pileOf(
  state: CascadeState,
  kind: PileKind,
  index: number,
): Card[] | null {
  switch (kind) {
    case "stock":
      return index === 0 ? state.stock : null;
    case "waste":
      return index === 0 ? state.waste : null;
    case "foundation":
      return state.foundations[index] ?? null;
    case "tableau":
      return state.tableau[index] ?? null;
  }
}

/** Every pile on the table, in the order the surface addresses them. */
export function everyPile(state: CascadeState): Card[][] {
  return [state.stock, state.waste, ...state.foundations, ...state.tableau];
}

/** The card with `id`, and the pile holding it, or `null`. */
export function findCard(
  state: CascadeState,
  id: number,
): { pile: Card[]; row: number } | null {
  for (const pile of everyPile(state)) {
    const row = pile.findIndex((card) => card.id === id);
    if (row >= 0) return { pile, row };
  }
  return null;
}
