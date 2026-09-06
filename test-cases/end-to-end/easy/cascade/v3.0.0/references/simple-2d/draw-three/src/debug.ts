// Cascade — the debugging and automation surface (`specs/instrumentation.md`).
//
// `createDebugApi()` builds it and `initialize` returns it beside the state, as
// `[state, createDebugApi()]`. The engine holds the second element and hands it
// back from `engine.debug`, and that is the one way a caller reaches it: nothing
// is installed on the page. It reaches nothing global, holds no state of its own,
// and is inert during normal play.
//
// Every operation is written in the shape of `update`, because nothing in this
// build holds a writable state. A POSE takes the current state and returns the
// next one, and a caller drives it through the engine, as
// `engine.apply((s) => debug.setScreen(s, "playing"))`. A READING takes the
// current state and returns what it read, as `debug.snapshot(engine.state)`.
// `move` and `autoMove` are neither: each applies the game's own rules and then
// reports what those rules decided, so each returns the pair
// `[nextState, verdict]` and a caller splits the pair INSIDE the transition.
//
// Each pose sets ONE field and takes scalars. There is no operation that takes a
// layout, none that arranges several things at once, and none that fabricates an
// outcome: a pose puts the table into a position, and the game's own move rules,
// turning, win test and cascade run from there when the engine advances a frame.
//
// Everything about DRIVING A BROWSER GAME rather than about Cascade belongs to
// the engine and is deliberately absent: there is no clock operation (the engine
// owns the clock and runs exact frames), no overlay toggle (the engine draws the
// panel and owns the backtick key), and no `setMuted` (the engine owns the mute
// bit; the HUD's `SOUND` control sets it and the snapshot reports it).

import {
  CASCADE_DEBUG_VERSION,
  DEAL_MODE,
  DEAL_MODE_LABEL,
  RANK_MAX,
  RANK_MIN,
  TURN_COUNT,
} from "./constants";
import { cardColor } from "./cards";
import { resetToTitle } from "./flow";
import { moveTo, pressAt, releaseAt } from "./pointer";
import {
  autoMoveFrom,
  clearTable as emptyEveryPile,
  clearTrail as eraseTrail,
  dealFresh,
  dropFromWasteSets,
  moveCards,
  refreshDropTarget,
  turnStock as turnTheStock,
} from "./table";
import {
  findCard,
  pileOf,
  takeId,
  toSim,
  visibleCount,
  type MutFlyer,
  type Sim,
} from "./sim";
import type { CascadeState, CardState, PileKind, Screen, Suit } from "./game";
import type { DeepReadonly } from "ts-essentials";
import { menuItemRect } from "./menus";
import type { Rect } from "./layout";

/** One card, as the snapshot reports it. */
export interface SnapshotCard {
  id: number;
  suit: Suit;
  rank: number;
  color: "red" | "black";
  faceUp: boolean;
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

  stock: SnapshotCard[];
  waste: SnapshotCard[];
  wasteSets: number[];
  wasteVisibleCount: number;
  foundations: SnapshotCard[][];
  tableau: SnapshotCard[][];

  drag: {
    cards: SnapshotCard[];
    fromPile: "waste" | "foundation" | "tableau";
    fromIndex: number;
    x: number;
    y: number;
  } | null;
  dropTarget: { pile: "foundation" | "tableau"; index: number } | null;
  pointer: { x: number; y: number; down: boolean };
  lastPress: { x: number; y: number; at: number } | null;

  launchClock: number;
  launched: number;
  flyers: {
    id: number;
    suit: Suit;
    rank: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
  }[];
  cascadeDone: boolean;
  trailStamps: number;

  simTime: number;
}

/** The surface `initialize` returns beside the state. */
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
}

/** Write `change` into a copy of the state and hand the copy back. */
function pose(
  state: DeepReadonly<CascadeState>,
  change: (sim: Sim) => void,
): CascadeState {
  const sim = toSim(state);
  change(sim);
  return sim;
}

/** Apply `change` to the flyer with that id, and leave the state alone otherwise. */
function poseFlyer(
  state: DeepReadonly<CascadeState>,
  id: number,
  change: (flyer: MutFlyer) => void,
): CascadeState {
  return pose(state, (sim) => {
    const flyer = sim.flyers.find((candidate) => candidate.id === id);
    if (flyer !== undefined) change(flyer);
  });
}

/** One card, in the plain shape the snapshot reports. */
function snapshotCard(card: DeepReadonly<CardState>): SnapshotCard {
  return {
    id: card.id,
    suit: card.suit,
    rank: card.rank,
    color: cardColor(card.suit),
    faceUp: card.faceUp,
  };
}

/** One pile, in the plain shape the snapshot reports. */
function snapshotPile(
  pile: DeepReadonly<readonly CardState[]>,
): SnapshotCard[] {
  return pile.map(snapshotCard);
}

/** The surface. Every member is one pose, one reading, or one verdict. */
export function createDebugApi(): CascadeDebugApi {
  return {
    version: CASCADE_DEBUG_VERSION,

    reset: (state) =>
      pose(state, (sim) => {
        resetToTitle(sim);
      }),

    snapshot: (state) => ({
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
      wasteVisibleCount: visibleCount(state.wasteSets),
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
    }),

    // ---- The screen -------------------------------------------------------

    menuItemRect: (state, index) => menuItemRect(state.screen, index),

    setScreen: (state, screen) =>
      pose(state, (sim) => {
        sim.screen = screen;
      }),

    setMenuIndex: (state, index) =>
      pose(state, (sim) => {
        sim.menuIndex = index;
      }),

    setTitleIndex: (state, index) =>
      pose(state, (sim) => {
        sim.titleIndex = index;
      }),

    // ---- The cards --------------------------------------------------------

    addCard: (state, pile, index, suit, rank, faceUp) =>
      pose(state, (sim) => {
        const cards = pileOf(sim, pile, index);
        if (cards === null) return;
        cards.push({
          id: takeId(sim),
          suit,
          rank: Math.max(RANK_MIN, Math.min(RANK_MAX, Math.round(rank))),
          faceUp,
        });
      }),

    removeCard: (state, id) =>
      pose(state, (sim) => {
        const found = findCard(sim, id);
        if (found === null) return;
        const cards = pileOf(sim, found.pile, found.index);
        if (cards === null) return;
        cards.splice(found.row, 1);
        // The waste's set memory follows the card off the pile, exactly as it
        // does when play takes the card (specs/stock.md).
        if (found.pile === "waste") dropFromWasteSets(sim, 1);
      }),

    setCardFaceUp: (state, id, faceUp) =>
      pose(state, (sim) => {
        const found = findCard(sim, id);
        if (found !== null) found.card.faceUp = faceUp;
      }),

    clearPile: (state, pile, index) =>
      pose(state, (sim) => {
        const cards = pileOf(sim, pile, index);
        if (cards === null) return;
        cards.length = 0;
        if (pile === "waste") sim.wasteSets = [];
      }),

    clearTable: (state) =>
      pose(state, (sim) => {
        emptyEveryPile(sim);
        // A held run holds cards the clear has taken off the table, so it goes
        // with them, and the drop target it was resolved against with it
        // (specs/instrumentation.md).
        sim.drag = null;
        sim.dropTarget = null;
      }),

    // ---- The waste's sets -------------------------------------------------

    addWasteSet: (state, count) =>
      pose(state, (sim) => {
        sim.wasteSets.push(Math.max(0, Math.round(count)));
      }),

    clearWasteSets: (state) =>
      pose(state, (sim) => {
        sim.wasteSets = [];
      }),

    // ---- The game's own events --------------------------------------------

    deal: (state) =>
      pose(state, (sim) => {
        dealFresh(sim);
      }),

    turnStock: (state) =>
      pose(state, (sim) => {
        turnTheStock(sim);
      }),

    move: (state, fromPile, fromIndex, fromRow, toPile, toIndex) => {
      let verdict = false;
      const next = pose(state, (sim) => {
        verdict = moveCards(sim, fromPile, fromIndex, fromRow, toPile, toIndex);
        refreshDropTarget(sim);
      });
      return [next, verdict];
    },

    autoMove: (state, pile, index) => {
      let verdict = false;
      const next = pose(state, (sim) => {
        verdict = autoMoveFrom(sim, pile, index);
        refreshDropTarget(sim);
      });
      return [next, verdict];
    },

    // ---- The pointer ------------------------------------------------------

    pointerDown: (state, x, y) =>
      pose(state, (sim) => {
        pressAt(sim, x, y);
      }),
    pointerMove: (state, x, y) =>
      pose(state, (sim) => {
        moveTo(sim, x, y);
      }),
    pointerUp: (state, x, y) =>
      pose(state, (sim) => {
        releaseAt(sim, x, y);
      }),

    // ---- The faculty gates ------------------------------------------------

    setAutoFlip: (state, enabled) =>
      pose(state, (sim) => {
        sim.autoFlip = enabled;
      }),

    setWinDetect: (state, enabled) =>
      pose(state, (sim) => {
        sim.winDetect = enabled;
      }),

    setLaunching: (state, enabled) =>
      pose(state, (sim) => {
        sim.launching = enabled;
      }),

    setTrailPainting: (state, enabled) =>
      pose(state, (sim) => {
        sim.trailPainting = enabled;
      }),

    // ---- The cascade ------------------------------------------------------

    addFlyer: (state, suit, rank, x, y, vx, vy) =>
      pose(state, (sim) => {
        sim.flyers.push({
          id: takeId(sim),
          suit,
          rank: Math.max(RANK_MIN, Math.min(RANK_MAX, Math.round(rank))),
          x,
          y,
          vx,
          vy,
        });
      }),

    setFlyerPosition: (state, id, x, y) =>
      poseFlyer(state, id, (flyer) => {
        flyer.x = x;
        flyer.y = y;
      }),

    setFlyerVelocity: (state, id, vx, vy) =>
      poseFlyer(state, id, (flyer) => {
        flyer.vx = vx;
        flyer.vy = vy;
      }),

    removeFlyer: (state, id) =>
      pose(state, (sim) => {
        sim.flyers = sim.flyers.filter((flyer) => flyer.id !== id);
      }),

    clearFlyers: (state) =>
      pose(state, (sim) => {
        sim.flyers = [];
      }),

    setLaunchClock: (state, seconds) =>
      pose(state, (sim) => {
        sim.launchClock = seconds;
      }),

    clearTrail: (state) =>
      pose(state, (sim) => {
        eraseTrail(sim);
      }),
  };
}
