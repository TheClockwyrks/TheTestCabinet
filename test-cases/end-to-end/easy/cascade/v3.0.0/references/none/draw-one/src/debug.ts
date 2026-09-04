// Cascade — the debugging and automation surface, `window.__cascade`.
//
// `specs/instrumentation.md` specifies it and this file implements it. It is
// installed by `src/main.ts` as soon as the game has initialized, and it is
// inert during normal play: nothing below runs until something calls it.
//
// EVERY OPERATION IS ONE OF FOUR THINGS. A read of the state (`snapshot`), a
// pose of one field of it (`setScreen`, `addCard`, `setLaunchClock`, the four
// gates, the flyer operations), a move of the clock (`setAutoStep`,
// `advance`), or one of the GAME'S OWN EVENTS (`deal`, `turnStock`, `move`,
// `autoMove`, and the three pointer operations). A pose arranges the table and
// nothing more; the game's own rules run from there exactly as they do in play,
// so a scenario driven from code behaves exactly like one played by hand.
//
// THE CLOCK IS THE EXCEPTION THAT REACHES PAST THE STATE, into the runtime,
// because this build stands on no engine and nothing outside it owns its clock.
// Without it a scenario could only be driven by waiting, and a check that waits
// measures the machine it ran on.
//
// MUTING REACHES PAST THE STATE TOO, for the same reason: the runtime layer
// holds the mute bit, so `setMuted` sets it directly and the HUD's `SOUND`
// control toggles that same bit (`specs/instrumentation.md`).
//
// WHAT IS DELIBERATELY ABSENT: nothing about the overlay, because the runtime
// draws the panel and owns the backtick key; and no pose for `titleIndex`,
// because the specification declares no operation for it — the field follows
// the title entry a player activates.

import { addFlyer as addFlyerTo } from "./cascade";
import {
  CASCADE_DEBUG_VERSION,
  DEAL_MODE,
  DEAL_MODE_LABEL,
  DEFAULT_SEED,
  TURN_COUNT,
} from "./constants";
import {
  autoMove as autoMoveFrom,
  dealCards,
  makeCard,
  moveRun,
  pileAt,
  takeFromWasteSets,
  turnStock as turnStockNow,
  wasteVisibleCount,
} from "./board";
import { resolvePointer } from "./controls";
import { menuItemRect } from "./menus";
import {
  clearTable as clearWholeTable,
  clearTrail as clearPaintedLayer,
  resetState,
  type CascadeState,
} from "./state";
import type { AudioPort } from "./audio-bus";
import type {
  Card,
  CardColor,
  Flyer,
  PileName,
  Rect,
  Screen,
  SourcePile,
  Suit,
  TargetPile,
} from "./types";
import { suitColor } from "./types";

/** The `window` property the surface is installed on. */
export const CASCADE_HANDLE = "__cascade";

/**
 * The runtime's clock, as the surface reaches it.
 *
 * Structural on purpose: `src/runtime.ts` satisfies it without knowing this
 * file exists, and a test can hand the surface a clock of its own.
 */
export interface DebugClock {
  /** Take the game off the wall clock, or give it back. */
  setAutoStep(enabled: boolean): void;
  /** Run `frames` whole frames covering `seconds` of game time. */
  advance(seconds: number, frames?: number): void;
}

/** A card as the snapshot reports it. */
export interface CardView {
  id: number;
  suit: Suit;
  rank: number;
  color: CardColor;
  faceUp: boolean;
}

/** The run in hand, as the snapshot reports it. */
export interface DragView {
  /** Bottom to top, so `cards[0]` is the grabbed card. */
  cards: CardView[];
  fromPile: SourcePile;
  fromIndex: number;
  /** The top-left of `cards[0]`. */
  x: number;
  y: number;
}

/** The pile a release would land the held run on. */
export interface DropTargetView {
  pile: TargetPile;
  index: number;
}

/** A card in flight, as the snapshot reports it. */
export interface FlyerView {
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

  stock: CardView[];
  waste: CardView[];
  wasteSets: number[];
  wasteVisibleCount: number;
  foundations: CardView[][];
  tableau: CardView[][];

  drag: DragView | null;
  dropTarget: DropTargetView | null;

  pointer: { x: number; y: number; down: boolean };
  lastPress: { x: number; y: number; at: number } | null;

  launchClock: number;
  launched: number;
  flyers: FlyerView[];
  cascadeDone: boolean;
  trailStamps: number;

  simTime: number;
}

export interface CascadeDebugApi {
  version: number;

  reset(options?: { seed?: number }): void;
  snapshot(): CascadeSnapshot;
  menuItemRect(index: number): Rect | null;

  setAutoStep(enabled: boolean): void;
  advance(seconds: number, frames?: number): void;

  setMuted(muted: boolean): void;

  setScreen(screen: Screen): void;
  setMenuIndex(index: number): void;
  setTitleIndex(index: number): void;

  addCard(
    pile: PileName,
    index: number,
    suit: Suit,
    rank: number,
    faceUp: boolean,
  ): void;
  removeCard(id: number): void;
  setCardFaceUp(id: number, faceUp: boolean): void;
  clearPile(pile: PileName, index: number): void;
  clearTable(): void;

  addWasteSet(count: number): void;
  clearWasteSets(): void;

  deal(): void;
  turnStock(): void;
  move(
    fromPile: PileName,
    fromIndex: number,
    fromRow: number,
    toPile: PileName,
    toIndex: number,
  ): boolean;
  autoMove(pile: PileName, index: number): boolean;

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

/** A card, as the snapshot reports it. */
function cardView(card: Card): CardView {
  return {
    id: card.id,
    suit: card.suit,
    rank: card.rank,
    color: suitColor(card.suit),
    faceUp: card.faceUp,
  };
}

function pileView(pile: readonly Card[]): CardView[] {
  return pile.map(cardView);
}

function flyerView(flyer: Flyer): FlyerView {
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

/** Every card on the table, whichever pile holds it. */
function everyPile(state: CascadeState): Card[][] {
  return [state.stock, state.waste, ...state.foundations, ...state.tableau];
}

/** Whether a pile name may be a move's source. */
function asSourcePile(pile: PileName): SourcePile | null {
  return pile === "stock" ? null : pile;
}

/** Whether a pile name may be a move's target. */
function asTargetPile(pile: PileName): TargetPile | null {
  return pile === "foundation" || pile === "tableau" ? pile : null;
}

/** Build the surface over one live state, the runtime's clock, and its bus. */
export function createDebugApi(
  state: CascadeState,
  clock: DebugClock,
  audio: AudioPort,
): CascadeDebugApi {
  return {
    version: CASCADE_DEBUG_VERSION,

    /**
     * Restore every declared field of the state to its title-screen value and
     * reseed all of the game's randomness.
     *
     * It does not touch the clock: whether the game is stepping itself is not a
     * declared field, `setAutoStep` is how that is said, and a driver that
     * resets mid-scenario means to re-pose the table rather than hand it back
     * to real time. `muted` is left exactly as it stands.
     */
    reset(options) {
      resetState(state, options?.seed ?? DEFAULT_SEED);
    },

    /** A pure read of the state. It changes nothing. */
    snapshot(): CascadeSnapshot {
      const drag = state.drag;
      const target = state.dropTarget;
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

        stock: pileView(state.stock),
        waste: pileView(state.waste),
        wasteSets: [...state.wasteSets],
        wasteVisibleCount: wasteVisibleCount(state),
        foundations: state.foundations.map(pileView),
        tableau: state.tableau.map(pileView),

        drag:
          drag === null
            ? null
            : {
                cards: pileView(drag.cards),
                fromPile: drag.fromPile,
                fromIndex: drag.fromIndex,
                x: drag.x,
                y: drag.y,
              },
        dropTarget:
          target === null ? null : { pile: target.pile, index: target.index },

        pointer: {
          x: state.pointer.x,
          y: state.pointer.y,
          down: state.pointer.down,
        },
        lastPress:
          press === null ? null : { x: press.x, y: press.y, at: press.at },

        launchClock: state.launchClock,
        launched: state.launched,
        flyers: state.flyers.map(flyerView),
        cascadeDone: state.cascadeDone,
        trailStamps: state.trailStamps,

        simTime: state.simTime,
      };
    },

    /**
     * Take the game off real time, and give it back.
     *
     * It changes no game state. Drawing is unaffected either way: the loop
     * keeps rendering, so the canvas shows the state the most recent frame
     * left.
     */
    setAutoStep(enabled) {
      clock.setAutoStep(Boolean(enabled));
    },

    /**
     * Run whole frames of game time immediately, each a real frame — the same
     * update the loop runs, then a render.
     *
     * Advancing while the game is still stepping automatically ADDS to what the
     * wall clock is already doing, so call `setAutoStep(false)` first.
     */
    advance(seconds, frames = 1) {
      clock.advance(seconds, frames);
    },

    /**
     * The hit region of item `index` on the menu the current screen shows.
     *
     * `null` on `won`, which shows no menu, and for an index naming no item of
     * the menu the current screen shows (`specs/instrumentation.md`). It is a
     * READING: the layout is this build's, and this is how it reports it.
     */
    menuItemRect(index) {
      return menuItemRect(state.screen, index);
    },

    /**
     * Set the runtime's mute bit: the same bit the HUD's `SOUND` control
     * toggles and the same bit `snapshot` reports as `muted`.
     *
     * It plays no cue and changes no other field
     * (`specs/instrumentation.md`, Muting).
     */
    setMuted(muted) {
      audio.setMuted(muted);
      // Mirrored at once as well as in every update, so the bit the snapshot
      // reports is the bit the runtime holds the instant the pose landed.
      state.muted = audio.muted();
    },

    /** Set the screen, leaving the table exactly as it stands. */
    setScreen(screen) {
      state.screen = screen;
    },

    /** Set the selected item on the menu the current screen shows. */
    setMenuIndex(index) {
      state.menuIndex = index;
    },

    /** Set the title entry a return to the title restores, and nothing else. */
    setTitleIndex(index) {
      state.titleIndex = index;
    },

    /**
     * Add one card to the top of a pile. It is appended, so it is the pile's
     * last entry, and it takes a fresh id the caller reads from the snapshot.
     * It touches no other pile and no other field, the set memory included.
     */
    addCard(pile, index, suit, rank, faceUp) {
      const target = pileAt(state, pile, index);
      if (target === null) {
        throw new RangeError(
          `Cascade: addCard(${pile}, ${index}) names no pile`,
        );
      }
      target.push(makeCard(state, suit, rank, Boolean(faceUp)));
    },

    /**
     * Remove one card from whichever pile holds it, leaving the rest of that
     * pile in order. A card taken off the waste comes off the newest set that
     * holds any, which is the rule play itself follows.
     */
    removeCard(id) {
      for (const pile of everyPile(state)) {
        const at = pile.findIndex((card) => card.id === id);
        if (at < 0) continue;
        pile.splice(at, 1);
        if (pile === state.waste) takeFromWasteSets(state);
        return;
      }
    },

    /** Set one card's face. */
    setCardFaceUp(id, faceUp) {
      for (const pile of everyPile(state)) {
        const card = pile.find((entry) => entry.id === id);
        if (card === undefined) continue;
        card.faceUp = Boolean(faceUp);
        return;
      }
    },

    /**
     * Empty one pile, leaving the other twelve standing. On the waste it empties
     * the set memory as well.
     */
    clearPile(pile, index) {
      const target = pileAt(state, pile, index);
      if (target === null) {
        throw new RangeError(
          `Cascade: clearPile(${pile}, ${index}) names no pile`,
        );
      }
      target.length = 0;
      if (pile === "waste") state.wasteSets.length = 0;
    },

    /**
     * Empty all thirteen piles and the waste's set memory, leaving the flyers,
     * the painted layer and every gate alone.
     */
    clearTable() {
      clearWholeTable(state);
      state.drag = null;
      state.dropTarget = null;
    },

    /** Append one set of `count` cards to the newest end of the set memory. */
    addWasteSet(count) {
      if (!Number.isInteger(count) || count < 0) {
        throw new RangeError(
          `Cascade: addWasteSet needs a whole, non-negative count, got ${count}`,
        );
      }
      state.wasteSets.push(count);
    },

    /** Empty the set memory, leaving the cards on the waste standing. */
    clearWasteSets() {
      state.wasteSets.length = 0;
    },

    /** Deal a fresh game from the seeded generator, as `specs/deal.md` states. */
    deal() {
      dealCards(state);
    },

    /** Turn the stock, or recycle the waste into it, as `specs/stock.md` states. */
    turnStock() {
      turnStockNow(state);
    },

    /**
     * Attempt a move and report what the game's own rules decided. An accepted
     * move applies through the same path a released drop uses, so a newly
     * exposed column card turns and a completed board wins; a refused one
     * leaves the board unchanged.
     */
    move(fromPile, fromIndex, fromRow, toPile, toIndex) {
      const source = asSourcePile(fromPile);
      const target = asTargetPile(toPile);
      if (source === null || target === null) return false;
      return moveRun(
        state,
        { pile: source, index: fromIndex, row: fromRow },
        { pile: target, index: toIndex },
      );
    },

    /** Send a pile's playable card home when that is legal, and report whether it went. */
    autoMove(pile, index) {
      return autoMoveFrom(state, pile, index);
    },

    /** Report a press at a logical stage point, resolved before the call returns. */
    pointerDown(x, y) {
      resolvePointer(state, { type: "down", x, y }, audio);
    },

    /** Report a move to a logical stage point. */
    pointerMove(x, y) {
      resolvePointer(state, { type: "move", x, y }, audio);
    },

    /** Report a release at a logical stage point. */
    pointerUp(x, y) {
      resolvePointer(state, { type: "up", x, y }, audio);
    },

    /** Gate the automatic turning of a column's newly exposed lowest card. */
    setAutoFlip(enabled) {
      state.autoFlip = Boolean(enabled);
    },

    /** Gate the check that every card is home and the move to the won screen. */
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
     * Put one card in flight, its top-left at a logical stage position. It is
     * appended and takes a fresh id, and it then flies, bounces, paints and
     * retires through the game's own cascade rules.
     */
    addFlyer(suit, rank, x, y, vx, vy) {
      addFlyerTo(state, suit, rank, x, y, vx, vy);
    },

    /** Set one flyer's top-left. */
    setFlyerPosition(id, x, y) {
      const flyer = state.flyers.find((entry) => entry.id === id);
      if (flyer === undefined) return;
      flyer.x = x;
      flyer.y = y;
    },

    /** Set one flyer's velocity, in logical units per second. */
    setFlyerVelocity(id, vx, vy) {
      const flyer = state.flyers.find((entry) => entry.id === id);
      if (flyer === undefined) return;
      flyer.vx = vx;
      flyer.vy = vy;
    },

    /** Remove one flyer from the flight. */
    removeFlyer(id) {
      const at = state.flyers.findIndex((entry) => entry.id === id);
      if (at >= 0) state.flyers.splice(at, 1);
    },

    /** Remove every flyer in flight. */
    clearFlyers() {
      state.flyers.length = 0;
    },

    /** Set the seconds accumulated toward the next launch. */
    setLaunchClock(seconds) {
      state.launchClock = seconds;
    },

    /** Clear the painted layer and its stamp count, leaving the flyers standing. */
    clearTrail() {
      clearPaintedLayer(state);
    },
  };
}

/**
 * Install the surface on `window.__cascade` and return the function that
 * removes it again, while the installed object is still the one this call
 * published.
 */
export function installDebugApi(
  state: CascadeState,
  clock: DebugClock,
  audio: AudioPort,
): () => void {
  const api = createDebugApi(state, clock, audio);
  const target = window as unknown as Record<string, unknown>;
  target[CASCADE_HANDLE] = api;
  return () => {
    if (target[CASCADE_HANDLE] === api) delete target[CASCADE_HANDLE];
  };
}
