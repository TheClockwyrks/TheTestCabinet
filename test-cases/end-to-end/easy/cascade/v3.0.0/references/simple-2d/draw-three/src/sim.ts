// Cascade — the working value a frame is built in.
//
// The engine holds the state by value and hands every reader a
// `DeepReadonly<CascadeState>` view, so nothing in this build ever writes to a
// state it was handed. What `update` and every debug pose do instead is COPY the
// state they were given into a `Sim` — a field-for-field mirror of `CascadeState`
// with the `readonly` markers dropped — advance that, and return it. TypeScript
// accepts the result as a `CascadeState` because a mutable field is assignable to
// a readonly one, so the copy costs a type assertion nowhere.
//
// The copy is deep down to the cards: every card of every pile, every card in
// hand and every flyer is rebuilt, so a frame can rewrite one without the state
// it came from noticing. `trail` is carried across by reference, because the
// painted layer is a drawing resource rather than a value.

import { FOUNDATION_COUNT, TABLEAU_COLUMNS, type CueName } from "./constants";
import type { CascadeState, PileKind, Screen, Suit, CardState } from "./game";
import type { TrailLayer } from "./trail";
import type { DeepReadonly } from "ts-essentials";

export interface MutCard {
  id: number;
  suit: Suit;
  rank: number;
  faceUp: boolean;
}

export interface MutDrag {
  cards: MutCard[];
  fromPile: "waste" | "foundation" | "tableau";
  fromIndex: number;
  x: number;
  y: number;
}

export interface MutDropTarget {
  pile: "foundation" | "tableau";
  index: number;
}

export interface MutPointer {
  x: number;
  y: number;
  down: boolean;
}

export interface MutPress {
  x: number;
  y: number;
  at: number;
}

export interface MutFlyer {
  id: number;
  suit: Suit;
  rank: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** The whole of `CascadeState`, writable, for the length of one transition. */
export interface Sim {
  screen: Screen;
  menuIndex: number;
  titleIndex: number;

  stock: MutCard[];
  waste: MutCard[];
  wasteSets: number[];
  foundations: MutCard[][];
  tableau: MutCard[][];

  drag: MutDrag | null;
  dropTarget: MutDropTarget | null;
  pointer: MutPointer;
  lastPress: MutPress | null;

  autoFlip: boolean;
  winDetect: boolean;
  launching: boolean;
  trailPainting: boolean;

  launchClock: number;
  launched: number;
  flyers: MutFlyer[];
  cascadeDone: boolean;
  trailStamps: number;

  nextId: number;
  simTime: number;
  muted: boolean;
  rngState: number;

  trail: TrailLayer;
  pendingCues: CueName[];
}

/** One card, copied out of the read-only view. */
export function copyCard(card: DeepReadonly<CardState>): MutCard {
  return { id: card.id, suit: card.suit, rank: card.rank, faceUp: card.faceUp };
}

/** One pile, copied card by card. */
function copyPile(pile: DeepReadonly<readonly CardState[]>): MutCard[] {
  return pile.map(copyCard);
}

/** Copy the state handed in into a value this transition may write. */
export function toSim(state: DeepReadonly<CascadeState>): Sim {
  return {
    screen: state.screen,
    menuIndex: state.menuIndex,
    titleIndex: state.titleIndex,

    stock: copyPile(state.stock),
    waste: copyPile(state.waste),
    wasteSets: [...state.wasteSets],
    foundations: state.foundations.map(copyPile),
    tableau: state.tableau.map(copyPile),

    drag:
      state.drag === null
        ? null
        : {
            cards: state.drag.cards.map(copyCard),
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

    autoFlip: state.autoFlip,
    winDetect: state.winDetect,
    launching: state.launching,
    trailPainting: state.trailPainting,

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

    nextId: state.nextId,
    simTime: state.simTime,
    muted: state.muted,
    rngState: state.rngState,

    // The painted layer is one handle for the life of the build, so it crosses
    // the copy by reference exactly as it stays the same object across frames.
    trail: state.trail as TrailLayer,
    pendingCues: [...state.pendingCues],
  };
}

/**
 * The id the next card or flyer takes.
 *
 * `specs/instrumentation.md` requires only that an id is distinct among the
 * entities live at one moment; a counter that never goes backwards gives that,
 * and it makes an id stable for as long as its entity exists.
 */
export function takeId(sim: Sim): number {
  const id = sim.nextId;
  sim.nextId = id + 1;
  return id;
}

/** Raise a cue, for the next `update` to play. */
export function raise(sim: Sim, cue: CueName): void {
  sim.pendingCues.push(cue);
}

/** The pile `pile`/`index` names, or `null` where there is no such pile. */
export function pileOf(
  sim: Sim,
  pile: PileKind,
  index: number,
): MutCard[] | null {
  switch (pile) {
    case "stock":
      return index === 0 ? sim.stock : null;
    case "waste":
      return index === 0 ? sim.waste : null;
    case "foundation":
      return index >= 0 && index < FOUNDATION_COUNT
        ? (sim.foundations[index] as MutCard[])
        : null;
    case "tableau":
      return index >= 0 && index < TABLEAU_COLUMNS
        ? (sim.tableau[index] as MutCard[])
        : null;
  }
}

/** The card with that id, and the pile holding it, or `null`. */
export function findCard(
  sim: Sim,
  id: number,
): { pile: PileKind; index: number; row: number; card: MutCard } | null {
  const search = (
    pile: PileKind,
    index: number,
    cards: MutCard[],
  ): { pile: PileKind; index: number; row: number; card: MutCard } | null => {
    const row = cards.findIndex((card) => card.id === id);
    if (row < 0) return null;
    return { pile, index, row, card: cards[row] as MutCard };
  };

  return (
    search("stock", 0, sim.stock) ??
    search("waste", 0, sim.waste) ??
    sim.foundations.reduce<ReturnType<typeof search>>(
      (found, cards, index) => found ?? search("foundation", index, cards),
      null,
    ) ??
    sim.tableau.reduce<ReturnType<typeof search>>(
      (found, cards, index) => found ?? search("tableau", index, cards),
      null,
    )
  );
}

/** How many cards the waste is showing: the newest set's count (specs/stock.md). */
export function visibleCount(wasteSets: readonly number[]): number {
  return wasteSets[wasteSets.length - 1] ?? 0;
}
