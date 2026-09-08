// Cascade — the debugging and automation surface, `window.__cascade`.
//
// `specs/instrumentation.md` specifies it and this file implements it. It is
// installed by `src/main.ts` as soon as the game has initialized, and it is inert
// during normal play: nothing below runs until something calls it.
//
// EACH OPERATION SETS ONE FIELD, READS THE STATE, MOVES THE CLOCK, OR IS ONE OF
// THE GAME'S OWN EVENTS, and each takes scalars. There is no operation that hands
// the build a whole board, because a table is built one card at a time —
// `clearTable`, `clearPile` and `addCard` are what let a scenario pose one pile
// and leave the other twelve standing. Four operations are the game's own events
// rather than poses: `deal`, `turnStock`, `move` and `autoMove` each route through
// exactly the code a player's gesture routes through and report only what the
// game's own rules decided.
//
// THE CLOCK REACHES PAST THE STATE, into the runtime, because this build stands on
// no engine and nothing outside it owns its clock. Without `setAutoStep` and
// `advance` a scenario could only be driven by waiting, and a check that waits
// measures the machine it ran on.
//
// THE FOUR GATES each hold ONE faculty still and nothing else, are on by default,
// are restored to on by `reset`, and are reported by `snapshot`, so each is
// verifiable by setting a value and reading it back.

import { cardColor, isRank, isSuit, type Card, type CardColor } from "./cards";
import { drawLaunchVx } from "./cascade";
import {
  CASCADE_DEBUG_VERSION,
  DEAL_MODE,
  DEAL_MODE_LABEL,
  TURN_COUNT,
  type Rect,
  type Suit,
} from "./constants";
import {
  autoMove as applyAutoMove,
  applyMove,
  deal as dealGame,
  turnStock as turnTheStock,
} from "./moves";
import { refreshDropTarget } from "./input";
import { menuItemRect } from "./menus";
import type { PointerPhase } from "./pointer";
import { takeId } from "./state";
import {
  clearTable as emptyTable,
  clearTrail as wipeTrail,
  findCard,
  pileOf,
  resetState,
  type CascadeState,
  type Flyer,
  type PileKind,
  type Screen,
} from "./state";
import {
  addWasteSet as pushWasteSet,
  clearWasteSets as emptyWasteSets,
  takeFromNewestSet,
  wasteVisibleCount,
} from "./waste";

/** The `window` property the surface is installed on. */
export const CASCADE_HANDLE = "__cascade";

/**
 * The runtime, as the surface reaches it: the clock, and the pointer path.
 *
 * Structural on purpose — `src/runtime.ts` satisfies it without knowing this file
 * exists, and a test can hand the surface a host of its own.
 */
export interface DebugHost {
  /** Take the game off the wall clock, or give it back. */
  setAutoStep(enabled: boolean): void;
  /** Run `frames` whole frames covering `seconds` of game time. */
  advance(seconds: number, frames?: number): void;
  /** Deliver one pointer sample at a point on the logical stage. */
  pointer(phase: PointerPhase, x: number, y: number): void;
  /**
   * Set the runtime's mute bit, and read it back.
   *
   * The runtime layer holds it, so `setMuted` reaches past the state exactly as
   * the clock does (specs/instrumentation.md, What the runtime provides
   * instead).
   */
  setMuted(muted: boolean): void;
  /** Whether the runtime's bus is muted. */
  muted(): boolean;
}

/** One card, as the snapshot reports it. */
export interface CardSnapshot {
  id: number;
  suit: Suit;
  rank: number;
  color: CardColor;
  faceUp: boolean;
}

/** One card in flight, as the snapshot reports it. */
export interface FlyerSnapshot {
  id: number;
  suit: Suit;
  rank: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** The run in hand, as the snapshot reports it. */
export interface DragSnapshot {
  cards: CardSnapshot[];
  fromPile: "waste" | "foundation" | "tableau";
  fromIndex: number;
  x: number;
  y: number;
}

/** The plain, JSON-serializable view `snapshot()` returns. */
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

/** Every operation the surface carries. */
export interface CascadeDebugApi {
  version: number;

  reset(): void;
  snapshot(): CascadeSnapshot;
  /** Bring every reported reading into agreement with the table as it stands. */
  reconcile(): void;

  menuItemRect(index: number): Rect | null;

  setAutoStep(enabled: boolean): void;
  advance(seconds: number, frames?: number): void;

  setMuted(muted: boolean): void;

  setScreen(screen: Screen): void;
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
  /** One launch's `vx` draw, performed alone: the signed value it drew. */
  drawLaunchVx(): number;
}

/** One card, as the snapshot reports it. */
function snapCard(card: Card): CardSnapshot {
  return {
    id: card.id,
    suit: card.suit,
    rank: card.rank,
    color: cardColor(card.suit),
    faceUp: card.faceUp,
  };
}

/** One pile, bottom to top. */
function snapPile(pile: readonly Card[]): CardSnapshot[] {
  return pile.map(snapCard);
}

/** A finite number, or a thrown complaint naming the operation. */
function requireFinite(op: string, name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `Cascade: ${op}() needs a finite ${name}, got ${value}`,
    );
  }
  return value;
}

/**
 * The flyer an id names, or a thrown complaint.
 *
 * An id no flyer in flight carries names nothing the surface can act on, so the
 * call fails loudly rather than passing quietly with the state unchanged
 * (`specs/instrumentation.md`, The operations).
 */
function requireFlyer(state: CascadeState, op: string, id: number): Flyer {
  const flyer = state.flyers.find((entry) => entry.id === id);
  if (flyer === undefined) {
    throw new RangeError(`Cascade: ${op}() has no flyer with id ${id}`);
  }
  return flyer;
}

/** The card an id names, or a thrown complaint. */
function requireCard(
  state: CascadeState,
  op: string,
  id: number,
): { pile: Card[]; row: number } {
  const found = findCard(state, id);
  if (found === null) {
    throw new RangeError(`Cascade: ${op}() has no card with id ${id}`);
  }
  return found;
}

/** The pile a `(kind, index)` pair names, or a thrown complaint. */
function requirePile(
  state: CascadeState,
  op: string,
  kind: PileKind,
  index: number,
): Card[] {
  const pile = pileOf(state, kind, index);
  if (pile === null) {
    throw new RangeError(`Cascade: ${op}() has no pile "${kind}" at ${index}`);
  }
  return pile;
}

/** Build the surface over one live state object and the runtime driving it. */
export function createDebugApi(
  state: CascadeState,
  host: DebugHost,
): CascadeDebugApi {
  return {
    version: CASCADE_DEBUG_VERSION,

    /**
     * Restore every declared field of the state to its title-screen value.
     *
     * `muted` is deliberately untouched: muting is a player preference the
     * runtime owns, and a reset is not a reason to start making noise again. The
     * clock is untouched too, because whether the game steps itself is
     * `setAutoStep`'s to say.
     */
    reset() {
      resetState(state);
    },

    /** A pure read. It changes nothing. */
    snapshot() {
      const drag = state.drag;
      const press = state.lastPress;
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

        stock: snapPile(state.stock),
        waste: snapPile(state.waste),
        wasteSets: [...state.wasteSets],
        wasteVisibleCount: wasteVisibleCount(state),
        foundations: state.foundations.map(snapPile),
        tableau: state.tableau.map(snapPile),

        drag:
          drag === null
            ? null
            : {
                cards: snapPile(drag.cards),
                fromPile: drag.fromPile,
                fromIndex: drag.fromIndex,
                x: drag.x,
                y: drag.y,
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
          press === null ? null : { x: press.x, y: press.y, at: press.at },

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

    /**
     * Take the game off real time, and give it back.
     *
     * Drawing is unaffected either way: the loop keeps rendering, so the canvas
     * shows the state the most recent frame left. It changes no game state.
     */
    setAutoStep(enabled) {
      host.setAutoStep(Boolean(enabled));
    },

    /**
     * Run `frames` whole frames covering `seconds` of game time, each worth
     * `seconds / frames`, immediately and in order. Each is a real frame: the
     * same update the loop runs, followed by a render.
     */
    advance(seconds, frames = 1) {
      host.advance(seconds, frames);
    },

    /**
     * Bring every reported reading into agreement with the table as it stands,
     * without advancing anything (specs/instrumentation.md, The core).
     *
     * Of this build's derived readings, `wasteVisibleCount` and a card's
     * `color` are worked out at the read, so there is nothing to rewrite for
     * either. `dropTarget` is the one it keeps: the pointer path writes it as a
     * gesture moves, so a pose that changes what the pile beneath a held run
     * holds leaves it answering for the table as it was. `refreshDropTarget` is
     * the rule the pointer path itself calls, so this is the same answer that
     * path would have written rather than a restatement of the drop rule.
     *
     * It runs no system and moves no clock. `simTime` and `launchClock` stand
     * where they were, no flyer moves or paints, no card turns, no win is
     * detected, no cue is raised, and nothing is drawn from the generator. It
     * corrects nothing either: a run held over a pile that no longer accepts it
     * is left in hand and simply reports no drop target.
     */
    reconcile() {
      refreshDropTarget(state);
    },

    /**
     * The hit region of item `index` on the menu the current screen shows.
     *
     * `null` on `won`, which shows no menu, and for an index naming no item of
     * the menu the current screen shows (specs/instrumentation.md). It is a
     * READING: the layout is this build's, and this is how it reports it.
     */
    menuItemRect(index) {
      return menuItemRect(state.screen, index);
    },

    /**
     * Set the runtime's mute bit: the same bit the HUD's `SOUND` control
     * toggles and the same bit `snapshot` reports as `muted`. It plays no cue
     * and changes no other field (specs/instrumentation.md, Muting).
     */
    setMuted(muted) {
      host.setMuted(muted);
      // Mirrored at once as well as in every update, so the bit the snapshot
      // reports is the bit the runtime holds the instant the pose landed.
      state.muted = host.muted();
    },

    /** The current screen, and nothing else: the table is left as it stands. */
    setScreen(screen) {
      state.screen = screen;
    },

    /** The selected item on the menu the current screen shows. */
    setMenuIndex(index) {
      state.menuIndex = index;
    },

    /** Set the title entry a return to the title restores, and nothing else. */
    setTitleIndex(index) {
      state.titleIndex = index;
    },

    /**
     * Add one card to the top of a pile.
     *
     * It is appended, so it is the pile's last entry, and it takes a fresh id the
     * caller reads from the snapshot. It touches no other pile and no other
     * field, the waste's set memory included.
     */
    addCard(pile, index, suit, rank, faceUp) {
      const target = requirePile(state, "addCard", pile, index);
      if (!isSuit(suit)) {
        throw new RangeError(`Cascade: addCard() has no suit "${suit}"`);
      }
      if (!isRank(rank)) {
        throw new RangeError(`Cascade: addCard() has no rank ${rank}`);
      }
      target.push({ id: takeId(state), suit, rank, faceUp: Boolean(faceUp) });
    },

    /**
     * Remove the card with that id, wherever it lies, leaving the rest of its
     * pile in order.
     *
     * A card taken off the waste comes off the newest set that holds any, and a
     * set left holding nothing leaves the memory, which is the rule play itself
     * follows.
     */
    removeCard(id) {
      const found = requireCard(state, "removeCard", id);
      found.pile.splice(found.row, 1);
      if (found.pile === state.waste) takeFromNewestSet(state);
    },

    /** Set one card's face. */
    setCardFaceUp(id, faceUp) {
      const found = requireCard(state, "setCardFaceUp", id);
      found.pile[found.row].faceUp = Boolean(faceUp);
    },

    /**
     * Empty one pile, leaving the other twelve standing. On the waste it empties
     * the set memory as well.
     */
    clearPile(pile, index) {
      const target = requirePile(state, "clearPile", pile, index);
      target.length = 0;
      if (target === state.waste) emptyWasteSets(state);
    },

    /**
     * Empty all thirteen piles and the waste's set memory, and with them the run
     * in hand and its drop target: a held run holds cards the clear has taken
     * off the table.
     *
     * It leaves the flyers, the painted layer and every gate alone, so a cleared
     * table is an isolated world rather than a whole reset.
     */
    clearTable() {
      emptyTable(state);
      state.drag = null;
      state.dropTarget = null;
    },

    /**
     * Append one set of `count` cards to the newest end of the memory.
     *
     * A count that is not a whole number of at least zero names no set the
     * memory could hold, so it fails loudly rather than being trimmed into one
     * (specs/instrumentation.md, The operations).
     */
    addWasteSet(count) {
      if (!Number.isInteger(count) || count < 0) {
        throw new RangeError(
          `Cascade: addWasteSet() needs a whole, non-negative count, got ${count}`,
        );
      }
      pushWasteSet(state, count);
    },

    /** Empty the memory, leaving the cards on the waste standing. */
    clearWasteSets() {
      emptyWasteSets(state);
    },

    /** Deal a fresh game, as specs/deal.md states. */
    deal() {
      dealGame(state);
    },

    /** Turn the stock, or recycle the waste into it, as specs/stock.md states. */
    turnStock() {
      turnTheStock(state);
    },

    /** Attempt a real move, and report what the game's own rules decided. */
    move(fromPile, fromIndex, fromRow, toPile, toIndex) {
      return applyMove(state, fromPile, fromIndex, fromRow, toPile, toIndex);
    },

    /** Send a pile's playable card home, and report whether it went. */
    autoMove(pile, index) {
      return applyAutoMove(state, pile, index);
    },

    /** A press at a logical stage point, resolved before the call returns. */
    pointerDown(x, y) {
      host.pointer("down", requireFinite("pointerDown", "x", x), y);
    },

    /** A move to a logical stage point, resolved before the call returns. */
    pointerMove(x, y) {
      host.pointer("move", requireFinite("pointerMove", "x", x), y);
    },

    /** A release at a logical stage point, resolved before the call returns. */
    pointerUp(x, y) {
      host.pointer("up", requireFinite("pointerUp", "x", x), y);
    },

    /** Gate the automatic turning of a column's newly exposed lowest card. */
    setAutoFlip(enabled) {
      state.autoFlip = Boolean(enabled);
    },

    /** Gate the win check and the move to the `won` screen. */
    setWinDetect(enabled) {
      state.winDetect = Boolean(enabled);
    },

    /** Gate the cascade's launch clock and the launching of the next card. */
    setLaunching(enabled) {
      state.launching = Boolean(enabled);
    },

    /** Gate the stamping of a card in flight onto the painted layer. */
    setTrailPainting(enabled) {
      state.trailPainting = Boolean(enabled);
    },

    /**
     * Add one card in flight, its top-left at a logical stage position.
     *
     * It is appended and takes a fresh id, and it then flies, bounces, paints and
     * retires through the game's own cascade rules.
     */
    addFlyer(suit, rank, x, y, vx, vy) {
      if (!isSuit(suit)) {
        throw new RangeError(`Cascade: addFlyer() has no suit "${suit}"`);
      }
      if (!isRank(rank)) {
        throw new RangeError(`Cascade: addFlyer() has no rank ${rank}`);
      }
      state.flyers.push({
        id: takeId(state),
        suit,
        rank,
        x: requireFinite("addFlyer", "x", x),
        y: requireFinite("addFlyer", "y", y),
        vx: requireFinite("addFlyer", "vx", vx),
        vy: requireFinite("addFlyer", "vy", vy),
      });
    },

    /** Set one flyer's top-left. */
    setFlyerPosition(id, x, y) {
      const flyer = requireFlyer(state, "setFlyerPosition", id);
      flyer.x = requireFinite("setFlyerPosition", "x", x);
      flyer.y = requireFinite("setFlyerPosition", "y", y);
    },

    /** Set one flyer's velocity, in logical units per second. */
    setFlyerVelocity(id, vx, vy) {
      const flyer = requireFlyer(state, "setFlyerVelocity", id);
      flyer.vx = requireFinite("setFlyerVelocity", "vx", vx);
      flyer.vy = requireFinite("setFlyerVelocity", "vy", vy);
    },

    /** Remove the flyer with that id. */
    removeFlyer(id) {
      const at = state.flyers.findIndex((entry) => entry.id === id);
      if (at < 0) {
        throw new RangeError(
          `Cascade: removeFlyer() has no flyer with id ${id}`,
        );
      }
      state.flyers.splice(at, 1);
    },

    /** Remove every flyer in flight. */
    clearFlyers() {
      state.flyers = [];
    },

    /** Set the seconds accumulated toward the next launch. */
    setLaunchClock(seconds) {
      state.launchClock = requireFinite("setLaunchClock", "seconds", seconds);
    },

    /** Clear the painted layer, leaving the flyers standing. */
    clearTrail() {
      wipeTrail(state);
    },

    /** The launch's own draw, taken without a launch. It touches no field. */
    drawLaunchVx() {
      return drawLaunchVx();
    },
  };
}

/**
 * Install the surface on `window.__cascade` and return the function that removes
 * it again, while the installed object is still the one this call published.
 */
export function installDebugApi(
  state: CascadeState,
  host: DebugHost,
): () => void {
  const api = createDebugApi(state, host);
  const target = globalThis as unknown as Record<string, unknown>;
  target[CASCADE_HANDLE] = api;
  return () => {
    if (target[CASCADE_HANDLE] === api) delete target[CASCADE_HANDLE];
  };
}
