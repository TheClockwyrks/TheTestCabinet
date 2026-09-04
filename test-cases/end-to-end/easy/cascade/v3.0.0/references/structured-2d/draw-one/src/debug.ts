// Cascade — the debugging and automation surface.
//
// The surface is specified by `specs/instrumentation.md` and implemented here.
// `createDebugApi` builds it, the game instance's `initialize` returns it, and
// the engine holds that same object and returns it from `engine.debug` — the one
// way a caller reaches it. Nothing is installed on the page.
//
// Every operation acts on the LIVE game at the moment it is called, reaching the
// open world through the accessor the instance supplies — `engine.world` at the
// call — and takes only the parameters its own row names. A POSE arranges the
// running game and returns nothing; a READING returns plain data built at the
// call and changes nothing. `move` and `autoMove` are the exception: each acts
// on the live game through its own rules and returns the verdict those rules
// reached.
//
// EACH POSE SETS ONE FIELD. There is no operation that takes a layout, a patch,
// or a bag of options: a table is built one card at a time, a waste is given its
// sets one set at a time, and each faculty is its own switch. That is what makes
// every pose verifiable by setting a value and reading it back through
// `snapshot`, and it is why the snapshot reports every field a pose can set.
//
// THE FOUR FACULTY GATES are what let a scenario hold one rule still while it
// exercises another: `setAutoFlip`, `setWinDetect`, `setLaunching` and
// `setTrailPainting` each hold ONE faculty, default to on, are restored to on by
// `reset`, and are reported by `snapshot`.
//
// Four operations are the game's own events rather than poses — `deal`,
// `turnStock`, `move` and `autoMove` — and each routes through exactly the code
// a player's gesture routes through, so what a scenario observes comes from the
// real systems. The three pointer operations do the same: they feed the same
// per-sample resolution the player controller feeds (`src/input.ts`), so the hit
// test, the grab rule, the drop rule and the double-click rule all run exactly
// as they do for a player, and each call takes effect before it returns.
//
// The surface holds no state and is inert during normal play: nothing below runs
// until something calls it.

import type { World } from "@test-cabinet/structured-2d";
import { applyAudio, noCues, type FrameCues } from "./audio";
import { addFlyerTo } from "./cascade";
import {
  CASCADE_DEBUG_VERSION,
  DEAL_MODE,
  DEAL_MODE_LABEL,
  DEFAULT_SEED,
  TURN_COUNT,
} from "./constants";
import { dealGame } from "./deal";
import { colorOf } from "./deck";
import { resetState } from "./flow";
import {
  cascadeState,
  type CardState,
  type CascadeState,
  type PileKind,
  type Screen,
  type Suit,
} from "./game";
import { wasteVisibleCount } from "./layout";
import { pointerDown, pointerMove, pointerUp } from "./input";
import { applyMove, autoMoveFrom } from "./moves";
import { dropWasteCard, findCard, newCard, pileArray } from "./piles";
import { turnStock } from "./stock";
import { menuItemRect } from "./menus";
import type { Rect } from "./layout";

// ---- The snapshot shape (specs/instrumentation.md) -----------------------

export interface SnapshotCard {
  id: number;
  suit: Suit;
  rank: number;
  color: "red" | "black";
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

export interface CascadeDebugApi {
  version: number;

  reset(options?: { seed?: number }): void;
  snapshot(): CascadeSnapshot;

  /**
   * The hit region of item `index` on the menu the current screen shows.
   *
   * A READING like `snapshot`: it changes nothing, and it is how this build
   * reports the layout specs/controls.md leaves to it. `null` on `won`, which
   * shows no menu, and for an index naming no item of the current screen's menu.
   */
  menuItemRect(index: number): Rect | null;

  setScreen(screen: Screen): void;
  /** Set the selected item on the menu the current screen shows. */
  setMenuIndex(index: number): void;
  setTitleIndex(index: number): void;

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

function snapshotCard(card: CardState): SnapshotCard {
  return {
    id: card.id,
    suit: card.suit,
    rank: card.rank,
    color: colorOf(card.suit),
    faceUp: card.faceUp,
  };
}

function snapshotPile(pile: readonly CardState[]): SnapshotCard[] {
  return pile.map(snapshotCard);
}

/**
 * Build the surface over an accessor for the open world. It holds nothing:
 * every operation reads the world — and the state and the audio bus it carries
 * — at the moment it is called, so the surface follows the live game for the
 * life of the engine.
 */
export function createDebugApi(world: () => World): CascadeDebugApi {
  const read = (): CascadeState => cascadeState(world());

  /** Play what one operation raised, exactly as a tick plays what it raised. */
  const play = (state: CascadeState, cues: FrameCues): void => {
    applyAudio(world().audio, state, cues);
  };

  const whole = (value: number): number => Math.max(0, Math.round(value));

  return {
    version: CASCADE_DEBUG_VERSION,

    reset(options) {
      resetState(read(), options?.seed ?? DEFAULT_SEED);
    },

    snapshot() {
      const state = read();
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

        stock: snapshotPile(state.stock),
        waste: snapshotPile(state.waste),
        wasteSets: [...state.wasteSets],
        wasteVisibleCount: wasteVisibleCount(state),
        foundations: state.foundations.map(snapshotPile),
        tableau: state.tableau.map(snapshotPile),

        drag:
          state.drag === null
            ? null
            : {
                cards: snapshotPile(state.drag.cards),
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

    menuItemRect(index) {
      return menuItemRect(read().screen, index);
    },

    /** The screen alone: the table is left exactly as it stands. */
    setScreen(screen) {
      read().screen = screen;
    },

    /** The selected item on the menu the current screen shows. */
    setMenuIndex(index) {
      read().menuIndex = index;
    },

    /** Set the title entry a return to the title restores, and nothing else. */
    setTitleIndex(index) {
      read().titleIndex = index;
    },

    /**
     * One card on the top of the named pile. It touches no other pile and no
     * other field, the waste's set memory included.
     */
    addCard(pile, index, suit, rank, faceUp) {
      const state = read();
      const cards = pileArray(state, pile, index);
      if (cards === null) return;
      cards.push(newCard(state, suit, rank, faceUp));
    },

    /**
     * The named card leaves whichever pile holds it, the rest of that pile
     * keeping its order. A card taken off the waste comes off the newest set
     * that holds any, which is the rule play itself follows.
     */
    removeCard(id) {
      const state = read();
      const site = findCard(state, id);
      if (site === null) return;
      const cards = pileArray(state, site.pile, site.index);
      if (cards === null) return;
      cards.splice(site.row, 1);
      if (site.pile === "waste") dropWasteCard(state);
    },

    setCardFaceUp(id, faceUp) {
      const state = read();
      const site = findCard(state, id);
      if (site === null) return;
      const cards = pileArray(state, site.pile, site.index);
      if (cards !== null) cards[site.row].faceUp = faceUp;
    },

    /** One pile emptied, the other twelve left standing. */
    clearPile(pile, index) {
      const state = read();
      const cards = pileArray(state, pile, index);
      if (cards === null) return;
      cards.length = 0;
      if (pile === "waste") state.wasteSets.length = 0;
    },

    /**
     * Every pile emptied, and the waste's set memory with them. The flyers, the
     * painted layer and every gate are left alone.
     */
    clearTable() {
      const state = read();
      state.stock.length = 0;
      state.waste.length = 0;
      state.wasteSets.length = 0;
      for (const pile of state.foundations) pile.length = 0;
      for (const pile of state.tableau) pile.length = 0;
      state.drag = null;
      state.dropTarget = null;
    },

    addWasteSet(count) {
      read().wasteSets.push(whole(count));
    },

    clearWasteSets() {
      read().wasteSets.length = 0;
    },

    deal() {
      const state = read();
      const cues = noCues();
      dealGame(state, cues);
      play(state, cues);
    },

    turnStock() {
      const state = read();
      const cues = noCues();
      turnStock(state, cues);
      play(state, cues);
    },

    move(fromPile, fromIndex, fromRow, toPile, toIndex) {
      const state = read();
      const cues = noCues();
      const accepted = applyMove(
        state,
        fromPile,
        fromIndex,
        fromRow,
        toPile,
        toIndex,
        cues,
      );
      play(state, cues);
      return accepted;
    },

    autoMove(pile, index) {
      const state = read();
      const cues = noCues();
      const went = autoMoveFrom(state, pile, index, cues);
      play(state, cues);
      return went;
    },

    pointerDown(x, y) {
      const state = read();
      const cues = noCues();
      pointerDown(state, x, y, cues);
      play(state, cues);
    },

    pointerMove(x, y) {
      const state = read();
      const cues = noCues();
      pointerMove(state, x, y, cues);
      play(state, cues);
    },

    pointerUp(x, y) {
      const state = read();
      const cues = noCues();
      pointerUp(state, x, y, cues);
      play(state, cues);
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

    /** One card in flight, which then flies, bounces, paints and retires by the game's own rules. */
    addFlyer(suit, rank, x, y, vx, vy) {
      addFlyerTo(read(), suit, rank, x, y, vx, vy);
    },

    setFlyerPosition(id, x, y) {
      const flyer = read().flyers.find((entry) => entry.id === id);
      if (flyer === undefined) return;
      flyer.x = x;
      flyer.y = y;
    },

    setFlyerVelocity(id, vx, vy) {
      const flyer = read().flyers.find((entry) => entry.id === id);
      if (flyer === undefined) return;
      flyer.vx = vx;
      flyer.vy = vy;
    },

    removeFlyer(id) {
      const state = read();
      state.flyers = state.flyers.filter((entry) => entry.id !== id);
    },

    clearFlyers() {
      read().flyers = [];
    },

    setLaunchClock(seconds) {
      read().launchClock = seconds;
    },

    /** The painted layer emptied, the flyers left in flight. */
    clearTrail() {
      const state = read();
      state.trail.clear();
      state.trailStamps = 0;
    },
  };
}
