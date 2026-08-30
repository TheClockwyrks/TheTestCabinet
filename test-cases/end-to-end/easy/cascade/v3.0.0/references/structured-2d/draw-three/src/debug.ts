// Cascade — the debugging and automation surface (`specs/instrumentation.md`).
//
// `createDebugApi` builds it, the game instance's `initialize` returns it, and the
// engine holds that same object and hands it back from `engine.debug` — the one
// way a caller reaches it. Nothing is installed on the page.
//
// Every operation acts on the LIVE game at the moment it is called, reaching the
// open world through the accessor the instance supplies (`engine.world` at the
// call), and takes only the parameters its own row names. A POSE arranges the
// running game and returns nothing; a READING returns plain data built at the
// call and changes nothing. `move` and `autoMove` are the exception: each applies
// the game's own rules and returns the verdict those rules reached.
//
// EACH POSE SETS ONE FIELD. No operation takes a layout, a patch or a bag of
// options: a table is built one card at a time, the waste's memory is posed one
// set at a time, and each faculty is its own switch. That is what makes every
// pose verifiable by setting a value and reading it back through `snapshot`, and
// it is why the snapshot reports every field a pose can set.
//
// THE FOUR GATES each hold one faculty of the rules — the automatic flip, the win
// test, the cascade's launching and the trail's painting — default to on, are
// restored to on by `reset`, and are reported by `snapshot`. They are what let a
// scenario hold still whatever its own requirement does not concern. Cascade
// needs no world gate beside them: the game is turn-based and moves only when it
// is moved, so an empty posed table is already an isolated world.
//
// The pointer operations do not stand in for the engine's pointer. They feed the
// SAME resolution the player controller feeds (`src/pointer.ts`), so the hit
// test, the grab rule, the drop rule and the double-click rule all run exactly as
// they do for a player, and each call takes effect before it returns.
//
// The surface holds no state and is inert during normal play: nothing below runs
// until something calls it.

import type { World } from "@test-cabinet/structured-2d";
import { applyEvents, noEvents, type FrameEvents } from "./audio";
import { addFlyerTo, flyerById } from "./cascade";
import {
  CASCADE_DEBUG_VERSION,
  DEAL_MODE,
  DEAL_MODE_LABEL,
  DEFAULT_SEED,
  TURN_COUNT,
} from "./constants";
import { clearTrail as clearPaintedLayer, dealGame } from "./deal";
import { colorOf, makeCard, type CardColor } from "./deck";
import { resetState } from "./flow";
import {
  cascadeState,
  type CardState,
  type CascadeState,
  type PileKind,
  type Screen,
  type Suit,
} from "./game";
import { attemptMove, autoMoveFrom } from "./moves";
import {
  allPiles,
  pileOf,
  takeFromWasteSets,
  wasteVisibleCount,
} from "./piles";
import { pointerDown, pointerMove, pointerUp } from "./pointer";
import { turnStock } from "./stock";

// ---- The snapshot shape (specs/instrumentation.md) -----------------------

export interface SnapshotCard {
  id: number;
  suit: Suit;
  rank: number;
  color: CardColor;
  faceUp: boolean;
}

export interface SnapshotDrag {
  cards: SnapshotCard[];
  fromPile: "waste" | "foundation" | "tableau";
  fromIndex: number;
  x: number;
  y: number;
}

export interface SnapshotDropTarget {
  pile: "foundation" | "tableau";
  index: number;
}

export interface SnapshotPointer {
  x: number;
  y: number;
  down: boolean;
}

export interface SnapshotPress {
  x: number;
  y: number;
  at: number;
}

export interface SnapshotFlyer {
  id: number;
  suit: Suit;
  rank: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface CascadeSnapshot {
  version: number;
  screen: Screen;
  dealMode: string;
  turnCount: number;
  dealModeLabel: string;
  muted: boolean;

  autoFlip: boolean;
  winDetect: boolean;
  launching: boolean;
  trailPainting: boolean;

  stock: SnapshotCard[];
  waste: SnapshotCard[];
  wasteSets: number[];
  wasteVisibleCount: number;
  foundations: SnapshotCard[][];
  tableau: SnapshotCard[][];

  drag: SnapshotDrag | null;
  dropTarget: SnapshotDropTarget | null;

  pointer: SnapshotPointer;
  lastPress: SnapshotPress | null;

  launchClock: number;
  launched: number;
  flyers: SnapshotFlyer[];
  cascadeDone: boolean;
  trailStamps: number;

  simTime: number;
}

// ---- The surface ---------------------------------------------------------

/**
 * The surface. Every pose acts on the live game at the call and returns nothing;
 * `snapshot` returns what it read; `move` and `autoMove` return the verdict the
 * game's own rules reached.
 */
export interface CascadeDebugApi {
  version: number;

  reset(options?: { seed?: number }): void;
  snapshot(): CascadeSnapshot;

  setScreen(screen: Screen): void;

  addCard(
    pile: PileKind,
    index: number,
    suit: Suit,
    rank: number,
    faceUp: boolean,
  ): void;
  removeCard(id: number): void;
  setCardFaceUp(id: number, faceUp: boolean): void;
  clearPile(pile: PileKind, index: number): void;
  clearTable(): void;

  addWasteSet(count: number): void;
  clearWasteSets(): void;

  deal(): void;
  turnStock(): void;
  move(
    fromPile: PileKind,
    fromIndex: number,
    fromRow: number,
    toPile: PileKind,
    toIndex: number,
  ): boolean;
  autoMove(pile: PileKind, index: number): boolean;

  pointerDown(x: number, y: number): void;
  pointerMove(x: number, y: number): void;
  pointerUp(x: number, y: number): void;

  setAutoFlip(enabled: boolean): void;
  setWinDetect(enabled: boolean): void;
  setLaunching(enabled: boolean): void;
  setTrailPainting(enabled: boolean): void;

  addFlyer(
    suit: Suit,
    rank: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
  ): void;
  setFlyerPosition(id: number, x: number, y: number): void;
  setFlyerVelocity(id: number, vx: number, vy: number): void;
  removeFlyer(id: number): void;
  clearFlyers(): void;
  setLaunchClock(seconds: number): void;
  clearTrail(): void;
}

/** A card as the snapshot reports it, its colour read from its suit. */
function reportCard(card: CardState): SnapshotCard {
  return {
    id: card.id,
    suit: card.suit,
    rank: card.rank,
    color: colorOf(card.suit),
    faceUp: card.faceUp,
  };
}

function reportPile(cards: readonly CardState[]): SnapshotCard[] {
  return cards.map(reportCard);
}

/**
 * Build the surface over an accessor for the open world. It holds nothing: every
 * operation reads the world — and the state and the cue bus it carries — at the
 * moment it is called, so the surface follows the live game for the life of the
 * engine.
 */
export function createDebugApi(world: () => World): CascadeDebugApi {
  const read = (): CascadeState => cascadeState(world());

  /**
   * One operation's batch: what it raised is played on the world's bus once per
   * kind, exactly as a tick's is, and the game's copy of the runtime's mute bit
   * is refreshed afterwards, exactly as an update refreshes it.
   */
  const perform = <T>(
    work: (state: CascadeState, events: FrameEvents) => T,
  ): T => {
    const state = read();
    const events = noEvents();
    const result = work(state, events);
    const audio = world().audio;
    applyEvents(audio, events);
    state.muted = audio.muted();
    return result;
  };

  /** The card with that id, wherever it lies, and the pile holding it. */
  const locate = (
    state: CascadeState,
    id: number,
  ): { pile: CardState[]; row: number; isWaste: boolean } | null => {
    for (const pile of allPiles(state)) {
      const row = pile.findIndex((card) => card.id === id);
      if (row >= 0) return { pile, row, isWaste: pile === state.waste };
    }
    return null;
  };

  return {
    version: CASCADE_DEBUG_VERSION,

    reset(options) {
      perform((state) => {
        resetState(state, options?.seed ?? DEFAULT_SEED);
      });
    },

    snapshot() {
      const state = read();
      return {
        version: CASCADE_DEBUG_VERSION,
        screen: state.screen,
        dealMode: DEAL_MODE,
        turnCount: TURN_COUNT,
        dealModeLabel: DEAL_MODE_LABEL,
        muted: state.muted,

        autoFlip: state.autoFlip,
        winDetect: state.winDetect,
        launching: state.launching,
        trailPainting: state.trailPainting,

        stock: reportPile(state.stock),
        waste: reportPile(state.waste),
        wasteSets: [...state.wasteSets],
        wasteVisibleCount: wasteVisibleCount(state),
        foundations: state.foundations.map(reportPile),
        tableau: state.tableau.map(reportPile),

        drag:
          state.drag === null
            ? null
            : {
                cards: reportPile(state.drag.cards),
                fromPile: state.drag.fromPile,
                fromIndex: state.drag.fromIndex,
                x: state.drag.x,
                y: state.drag.y,
              },
        dropTarget:
          state.dropTarget === null
            ? null
            : { pile: state.dropTarget.pile, index: state.dropTarget.index },

        pointer: {
          x: state.pointer.x,
          y: state.pointer.y,
          down: state.pointer.down,
        },
        lastPress:
          state.lastPress === null
            ? null
            : {
                x: state.lastPress.x,
                y: state.lastPress.y,
                at: state.lastPress.at,
              },

        launchClock: state.launchClock,
        launched: state.launched,
        flyers: state.flyers.map((flyer) => ({
          id: flyer.id,
          suit: flyer.suit,
          rank: flyer.rank,
          x: flyer.x,
          y: flyer.y,
          vx: flyer.vx,
          vy: flyer.vy,
        })),
        cascadeDone: state.cascadeDone,
        trailStamps: state.trailStamps,

        simTime: state.simTime,
      };
    },

    setScreen(screen) {
      read().screen = screen;
    },

    /**
     * One card on the top of the named pile. It is appended, so it is the pile's
     * last entry and its id is read from the snapshot, and it touches no other
     * pile and no other field, the waste's set memory included.
     */
    addCard(pile, index, suit, rank, faceUp) {
      const state = read();
      const cards = pileOf(state, pile, index);
      if (cards === null) return;
      cards.push(makeCard(state, suit, rank, faceUp));
    },

    /**
     * The card with that id leaves whichever pile holds it, and the rest of that
     * pile keeps its order. A card taken off the waste leaves the newest set that
     * holds any, which is the rule play itself follows.
     */
    removeCard(id) {
      const state = read();
      const found = locate(state, id);
      if (found === null) return;
      found.pile.splice(found.row, 1);
      if (found.isWaste) takeFromWasteSets(state);
    },

    setCardFaceUp(id, faceUp) {
      const state = read();
      const found = locate(state, id);
      if (found === null) return;
      found.pile[found.row].faceUp = faceUp;
    },

    /** One pile emptied, the other twelve left standing. */
    clearPile(pile, index) {
      const state = read();
      const cards = pileOf(state, pile, index);
      if (cards === null) return;
      cards.length = 0;
      if (pile === "waste") state.wasteSets = [];
    },

    /** Every pile emptied. The flyers, the painted layer and the gates stand. */
    clearTable() {
      const state = read();
      for (const pile of allPiles(state)) pile.length = 0;
      state.wasteSets = [];
    },

    addWasteSet(count) {
      read().wasteSets.push(count);
    },

    clearWasteSets() {
      read().wasteSets = [];
    },

    deal() {
      perform((state, events) => {
        dealGame(state, events);
      });
    },

    turnStock() {
      perform((state, events) => {
        turnStock(state, events);
      });
    },

    move(fromPile, fromIndex, fromRow, toPile, toIndex) {
      return perform((state, events) =>
        attemptMove(
          state,
          fromPile,
          fromIndex,
          fromRow,
          toPile,
          toIndex,
          events,
        ),
      );
    },

    autoMove(pile, index) {
      return perform((state, events) =>
        autoMoveFrom(state, pile, index, events),
      );
    },

    pointerDown(x, y) {
      perform((state, events) => {
        pointerDown(state, x, y, events);
      });
    },

    pointerMove(x, y) {
      perform((state, events) => {
        pointerMove(state, x, y, events);
      });
    },

    pointerUp(x, y) {
      perform((state, events) => {
        pointerUp(state, x, y, events);
      });
    },

    setAutoFlip(enabled) {
      read().autoFlip = enabled;
    },

    setWinDetect(enabled) {
      read().winDetect = enabled;
    },

    setLaunching(enabled) {
      read().launching = enabled;
    },

    setTrailPainting(enabled) {
      read().trailPainting = enabled;
    },

    /** One card in flight, which then flies by the game's own cascade rules. */
    addFlyer(suit, rank, x, y, vx, vy) {
      addFlyerTo(read(), suit, rank, x, y, vx, vy);
    },

    setFlyerPosition(id, x, y) {
      const flyer = flyerById(read(), id);
      if (flyer === undefined) return;
      flyer.x = x;
      flyer.y = y;
    },

    setFlyerVelocity(id, vx, vy) {
      const flyer = flyerById(read(), id);
      if (flyer === undefined) return;
      flyer.vx = vx;
      flyer.vy = vy;
    },

    removeFlyer(id) {
      const state = read();
      state.flyers = state.flyers.filter((flyer) => flyer.id !== id);
    },

    clearFlyers() {
      read().flyers = [];
    },

    setLaunchClock(seconds) {
      read().launchClock = seconds;
    },

    /** The painted layer emptied, every card in flight left standing. */
    clearTrail() {
      clearPaintedLayer(read());
    },
  };
}
