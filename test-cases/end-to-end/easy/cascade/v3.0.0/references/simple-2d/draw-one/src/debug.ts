// Cascade — the debugging and automation surface (specs/instrumentation.md).
//
// `createDebugApi()` builds it and `initialize` returns it beside the state, as
// the pair `[state, debug]`, so the engine holds it and `engine.debug` is the one
// route to it. Nothing is installed on the page, nothing here holds state, and
// nothing runs until a caller calls it.
//
// Every operation is written in the shape of `update`, because nothing in the
// engine hands out a writable state. A POSE takes the current state and returns
// the next one, driven through `engine.apply`; a READING takes the state and
// returns what it read, given `engine.state`. `move` and `autoMove` are neither:
// each applies the game's own rules and then reports what those rules decided, so
// each returns the pair `[nextState, verdict]`.
//
// The poses ARRANGE THE TABLE one field at a time and never announce an outcome.
// `deal`, `turnStock`, `move`, and `autoMove` are the exception the specification
// names: each is the game's own event, routed through exactly the code a player's
// gesture routes through, so what a scenario observes comes from the real rules.
// Cues are the one thing a pose cannot raise, because a pose runs between frames
// and a cue belongs to the frame its event happened on; `update` plays what the
// frame's own work raised.

import {
  CASCADE_DEBUG_VERSION,
  DEAL_MODE,
  DEAL_MODE_LABEL,
  TURN_COUNT,
} from "./constants";
import { drawLaunchVx } from "./cascade";
import { colorOf, type CardColor } from "./deck";
import { openingState } from "./flow";
import {
  autoMove,
  deal,
  emptyFoundations,
  emptyTableau,
  moveRun,
  turnStock,
} from "./moves";
import {
  appendWasteSet,
  dropFromNewestSet,
  findCard,
  isPile,
  pileCards,
  takeIds,
  wasteVisibleCount,
  withPile,
} from "./piles";
import { pointerDown, pointerMove, pointerUp } from "./pointer";
import type {
  CardState,
  CascadeState,
  FlyerState,
  PileKind,
  Screen,
  Suit,
} from "./game";
import type { DeepReadonly } from "ts-essentials";
import { menuItemRect } from "./layout";
import type { Rect } from "./layout";

/** A card as the snapshot reports it: its identity, its face, and its color. */
export interface CardSnapshot {
  id: number;
  suit: Suit;
  rank: number;
  color: CardColor;
  faceUp: boolean;
}

/** A card in flight as the snapshot reports it. */
export interface FlyerSnapshot {
  id: number;
  suit: Suit;
  rank: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** The run in hand as the snapshot reports it. */
export interface DragSnapshot {
  cards: CardSnapshot[];
  fromPile: "waste" | "foundation" | "tableau";
  fromIndex: number;
  x: number;
  y: number;
}

/** The plain, JSON-serializable view `snapshot` returns. */
export interface CascadeSnapshot {
  version: number;
  screen: Screen;
  menuIndex: number;
  titleIndex: number;
  dealMode: string;
  turnCount: number;
  dealModeLabel: string;
  muted: boolean;

  autoFlip: boolean;
  winDetect: boolean;
  launching: boolean;
  trailPainting: boolean;

  stock: CardSnapshot[];
  waste: CardSnapshot[];
  wasteSets: number[];
  wasteVisibleCount: number;
  foundations: CardSnapshot[][];
  tableau: CardSnapshot[][];

  drag: DragSnapshot | null;
  dropTarget: { pile: "foundation" | "tableau"; index: number } | null;

  pointer: { x: number; y: number; down: boolean };
  lastPress: { x: number; y: number; at: number } | null;

  launchClock: number;
  launched: number;
  flyers: FlyerSnapshot[];
  cascadeDone: boolean;
  trailStamps: number;

  simTime: number;
}

/** The surface `initialize` returns beside the state it built. */
export interface CascadeDebugApi {
  version: number;

  reset(state: DeepReadonly<CascadeState>): CascadeState;
  snapshot(state: DeepReadonly<CascadeState>): CascadeSnapshot;
  /**
   * The hit region of item `index` on the menu the current screen shows.
   *
   * A READING like `snapshot`: it changes nothing, and it is how this build
   * reports the layout specs/controls.md leaves to it. `null` on `won`, which
   * shows no menu, and for an index naming no item of the current screen's menu.
   */
  menuItemRect(state: DeepReadonly<CascadeState>, index: number): Rect | null;

  setScreen(state: DeepReadonly<CascadeState>, screen: Screen): CascadeState;
  /** Set the selected item on the menu the current screen shows. */
  setMenuIndex(state: DeepReadonly<CascadeState>, index: number): CascadeState;
  setTitleIndex(state: DeepReadonly<CascadeState>, index: number): CascadeState;

  addCard(
    state: DeepReadonly<CascadeState>,
    pile: PileKind,
    index: number,
    suit: Suit,
    rank: number,
    faceUp: boolean,
  ): CascadeState;
  removeCard(state: DeepReadonly<CascadeState>, id: number): CascadeState;
  setCardFaceUp(
    state: DeepReadonly<CascadeState>,
    id: number,
    faceUp: boolean,
  ): CascadeState;
  clearPile(
    state: DeepReadonly<CascadeState>,
    pile: PileKind,
    index: number,
  ): CascadeState;
  clearTable(state: DeepReadonly<CascadeState>): CascadeState;

  addWasteSet(state: DeepReadonly<CascadeState>, count: number): CascadeState;
  clearWasteSets(state: DeepReadonly<CascadeState>): CascadeState;

  deal(state: DeepReadonly<CascadeState>): CascadeState;
  turnStock(state: DeepReadonly<CascadeState>): CascadeState;
  move(
    state: DeepReadonly<CascadeState>,
    fromPile: PileKind,
    fromIndex: number,
    fromRow: number,
    toPile: PileKind,
    toIndex: number,
  ): [CascadeState, boolean];
  autoMove(
    state: DeepReadonly<CascadeState>,
    pile: PileKind,
    index: number,
  ): [CascadeState, boolean];

  pointerDown(
    state: DeepReadonly<CascadeState>,
    x: number,
    y: number,
  ): CascadeState;
  pointerMove(
    state: DeepReadonly<CascadeState>,
    x: number,
    y: number,
  ): CascadeState;
  pointerUp(
    state: DeepReadonly<CascadeState>,
    x: number,
    y: number,
  ): CascadeState;

  setAutoFlip(
    state: DeepReadonly<CascadeState>,
    enabled: boolean,
  ): CascadeState;
  setWinDetect(
    state: DeepReadonly<CascadeState>,
    enabled: boolean,
  ): CascadeState;
  setLaunching(
    state: DeepReadonly<CascadeState>,
    enabled: boolean,
  ): CascadeState;
  setTrailPainting(
    state: DeepReadonly<CascadeState>,
    enabled: boolean,
  ): CascadeState;

  addFlyer(
    state: DeepReadonly<CascadeState>,
    suit: Suit,
    rank: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
  ): CascadeState;
  setFlyerPosition(
    state: DeepReadonly<CascadeState>,
    id: number,
    x: number,
    y: number,
  ): CascadeState;
  setFlyerVelocity(
    state: DeepReadonly<CascadeState>,
    id: number,
    vx: number,
    vy: number,
  ): CascadeState;
  removeFlyer(state: DeepReadonly<CascadeState>, id: number): CascadeState;
  clearFlyers(state: DeepReadonly<CascadeState>): CascadeState;
  setLaunchClock(
    state: DeepReadonly<CascadeState>,
    seconds: number,
  ): CascadeState;
  clearTrail(state: DeepReadonly<CascadeState>): CascadeState;
  /** One launch's `vx` draw, performed alone: the signed value it drew. */
  drawLaunchVx(state: DeepReadonly<CascadeState>): number;
}

// ---- Reading the state ---------------------------------------------------

function cardView(card: CardState): CardSnapshot {
  return {
    id: card.id,
    suit: card.suit,
    rank: card.rank,
    color: colorOf(card.suit),
    faceUp: card.faceUp,
  };
}

function pileView(cards: readonly CardState[]): CardSnapshot[] {
  return cards.map(cardView);
}

function flyerView(flyer: FlyerState): FlyerSnapshot {
  return {
    id: flyer.id,
    suit: flyer.suit,
    rank: flyer.rank,
    x: flyer.x,
    y: flyer.y,
    vx: flyer.vx,
    vy: flyer.vy,
  };
}

// ---- Posing the flyers ---------------------------------------------------

function withFlyer(
  state: CascadeState,
  id: number,
  patch: (flyer: FlyerState) => FlyerState,
): CascadeState {
  return {
    ...state,
    flyers: state.flyers.map((flyer) =>
      flyer.id === id ? patch(flyer) : flyer,
    ),
  };
}

// ---- The surface ---------------------------------------------------------

/**
 * Build the surface. It closes over nothing, so the object returned here is safe
 * to hold for the life of the engine.
 */
export function createDebugApi(): CascadeDebugApi {
  return {
    version: CASCADE_DEBUG_VERSION,

    reset(state) {
      return openingState(state.muted, state.trail);
    },

    snapshot(state): CascadeSnapshot {
      return {
        version: CASCADE_DEBUG_VERSION,
        screen: state.screen,
        menuIndex: state.menuIndex,
        titleIndex: state.titleIndex,
        dealMode: DEAL_MODE,
        turnCount: TURN_COUNT,
        dealModeLabel: DEAL_MODE_LABEL,
        muted: state.muted,

        autoFlip: state.autoFlip,
        winDetect: state.winDetect,
        launching: state.launching,
        trailPainting: state.trailPainting,

        stock: pileView(state.stock),
        waste: pileView(state.waste),
        wasteSets: [...state.wasteSets],
        wasteVisibleCount: wasteVisibleCount(state),
        foundations: state.foundations.map(pileView),
        tableau: state.tableau.map(pileView),

        drag:
          state.drag === null
            ? null
            : {
                cards: pileView(state.drag.cards),
                fromPile: state.drag.fromPile,
                fromIndex: state.drag.fromIndex,
                x: state.drag.x,
                y: state.drag.y,
              },
        dropTarget:
          state.dropTarget === null
            ? null
            : { pile: state.dropTarget.pile, index: state.dropTarget.index },

        pointer: { ...state.pointer },
        lastPress: state.lastPress === null ? null : { ...state.lastPress },

        launchClock: state.launchClock,
        launched: state.launched,
        flyers: state.flyers.map(flyerView),
        cascadeDone: state.cascadeDone,
        trailStamps: state.trailStamps,

        simTime: state.simTime,
      };
    },

    menuItemRect(state, index) {
      return menuItemRect(state.screen, index);
    },

    setScreen(state, screen) {
      return { ...state, screen };
    },

    setMenuIndex(state, index) {
      return { ...state, menuIndex: index };
    },

    setTitleIndex(state, index) {
      return { ...state, titleIndex: index };
    },

    addCard(state, pile, index, suit, rank, faceUp) {
      if (!isPile(pile, index)) return state;
      const [ids, nextId] = takeIds(state, 1);
      const cards = [
        ...pileCards(state, pile, index),
        { id: ids[0], suit, rank, faceUp },
      ];
      return { ...withPile(state, pile, index, cards), nextId };
    },

    removeCard(state, id) {
      const ref = findCard(state, id);
      if (ref === null) return state;
      const cards = pileCards(state, ref.pile, ref.index);
      const next = withPile(
        state,
        ref.pile,
        ref.index,
        cards.filter((card) => card.id !== id),
      );
      return ref.pile === "waste"
        ? { ...next, wasteSets: dropFromNewestSet(next.wasteSets) }
        : next;
    },

    setCardFaceUp(state, id, faceUp) {
      const ref = findCard(state, id);
      if (ref === null) return state;
      const cards = pileCards(state, ref.pile, ref.index).map((card) =>
        card.id === id ? { ...card, faceUp } : card,
      );
      return withPile(state, ref.pile, ref.index, cards);
    },

    clearPile(state, pile, index) {
      if (!isPile(pile, index)) return state;
      const cleared = withPile(state, pile, index, []);
      return pile === "waste" ? { ...cleared, wasteSets: [] } : cleared;
    },

    clearTable(state) {
      return {
        ...state,
        stock: [],
        waste: [],
        wasteSets: [],
        foundations: emptyFoundations(),
        tableau: emptyTableau(),
        // A held run holds cards the clear has taken off the table, so it goes
        // with them, and the drop target it was resolved against with it
        // (specs/instrumentation.md).
        drag: null,
        dropTarget: null,
      };
    },

    addWasteSet(state, count) {
      return { ...state, wasteSets: appendWasteSet(state.wasteSets, count) };
    },

    clearWasteSets(state) {
      return { ...state, wasteSets: [] };
    },

    deal(state) {
      return deal(state).state;
    },

    turnStock(state) {
      return turnStock(state).state;
    },

    move(state, fromPile, fromIndex, fromRow, toPile, toIndex) {
      if (!isPile(fromPile, fromIndex) || !isPile(toPile, toIndex)) {
        return [state, false];
      }
      const outcome = moveRun(
        state,
        { pile: fromPile, index: fromIndex, row: fromRow },
        { pile: toPile, index: toIndex },
      );
      return [outcome.state, outcome.accepted];
    },

    autoMove(state, pile, index) {
      if (!isPile(pile, index)) return [state, false];
      const outcome = autoMove(state, pile, index);
      return [outcome.state, outcome.accepted];
    },

    pointerDown(state, x, y) {
      return pointerDown(state, x, y).state;
    },

    pointerMove(state, x, y) {
      return pointerMove(state, x, y).state;
    },

    pointerUp(state, x, y) {
      return pointerUp(state, x, y).state;
    },

    setAutoFlip(state, enabled) {
      return { ...state, autoFlip: enabled };
    },

    setWinDetect(state, enabled) {
      return { ...state, winDetect: enabled };
    },

    setLaunching(state, enabled) {
      return { ...state, launching: enabled };
    },

    setTrailPainting(state, enabled) {
      return { ...state, trailPainting: enabled };
    },

    addFlyer(state, suit, rank, x, y, vx, vy) {
      const [ids, nextId] = takeIds(state, 1);
      return {
        ...state,
        flyers: [...state.flyers, { id: ids[0], suit, rank, x, y, vx, vy }],
        nextId,
      };
    },

    setFlyerPosition(state, id, x, y) {
      return withFlyer(state, id, (flyer) => ({ ...flyer, x, y }));
    },

    setFlyerVelocity(state, id, vx, vy) {
      return withFlyer(state, id, (flyer) => ({ ...flyer, vx, vy }));
    },

    removeFlyer(state, id) {
      return {
        ...state,
        flyers: state.flyers.filter((flyer) => flyer.id !== id),
      };
    },

    clearFlyers(state) {
      return { ...state, flyers: [] };
    },

    setLaunchClock(state, seconds) {
      return { ...state, launchClock: seconds };
    },

    clearTrail(state) {
      state.trail?.clear();
      return { ...state, trailStamps: 0 };
    },

    /** The launch's own draw, taken without a launch. It reads no field. */
    drawLaunchVx() {
      return drawLaunchVx();
    },
  };
}
