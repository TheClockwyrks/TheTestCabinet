// Cascade — the moves the game makes: the deal, a turn of the stock, a run
// changing piles, and the auto-move (specs/deal.md, specs/stock.md,
// specs/tableau.md, specs/foundations.md, specs/victory.md).
//
// Every function here is pure. Each takes the state and returns the next one
// beside the cues its work raised, and the caller decides what to do with those:
// `update` plays them, and the debug surface's poses discard them, because a
// pose is driven between frames where no cue has a frame to sound on. That split
// is what lets one implementation of a rule serve both a player's gesture and a
// scenario driven from code.

import {
  CUES,
  DEAL_STOCK_CARDS,
  FOUNDATION_COUNT,
  LAUNCH_INTERVAL,
  TABLEAU_COLUMNS,
  TURN_COUNT,
  type CueName,
} from "./constants";
import { makeCard, shuffledDeck } from "./deck";
import {
  appendWasteSet,
  dropFromNewestSet,
  pileCards,
  shownWasteCount,
  takeIds,
  withPile,
} from "./piles";
import type { CardRef, PileRef } from "./piles";
import {
  boardComplete,
  foundationAccepts,
  foundationFor,
  tableauAccepts,
} from "./rules";
import type { CardState, CascadeState } from "./game";

/** A transition and the cues its work raised, in the order they were raised. */
export interface Outcome {
  readonly state: CascadeState;
  readonly cues: readonly CueName[];
}

/** An attempted move: the outcome, plus what the game's own rules decided. */
export interface MoveOutcome extends Outcome {
  readonly accepted: boolean;
}

/** An outcome that changed nothing and raised nothing. */
export function unchanged(state: CascadeState): Outcome {
  return { state, cues: [] };
}

// ---- The deal ------------------------------------------------------------

/**
 * A fresh deal (specs/deal.md).
 *
 * The whole deck is shuffled from the seeded generator and dealt column by
 * column, one to the first and seven to the last, each column's last card face
 * up; the twenty-four cards left over form the face-down stock. It replaces the
 * thirteen piles and the waste's set memory, sets `launched` to `0`, and clears
 * the painted table, and it changes no other field.
 */
export function deal(state: CascadeState): Outcome {
  const [faces, rngState] = shuffledDeck(state.rngState);
  const [ids, nextId] = takeIds(state, faces.length);

  const tableau: CardState[][] = [];
  let taken = 0;
  for (let column = 0; column < TABLEAU_COLUMNS; column++) {
    const cards: CardState[] = [];
    for (let n = 0; n <= column; n++) {
      const face = faces[taken];
      cards.push(makeCard(ids[taken], face.suit, face.rank, n === column));
      taken++;
    }
    tableau.push(cards);
  }

  const stock: CardState[] = [];
  for (let n = 0; n < DEAL_STOCK_CARDS; n++) {
    const face = faces[taken];
    stock.push(makeCard(ids[taken], face.suit, face.rank, false));
    taken++;
  }

  state.trail?.clear();

  return {
    state: {
      ...state,
      stock,
      waste: [],
      wasteSets: [],
      foundations: emptyFoundations(),
      tableau,
      launched: 0,
      trailStamps: 0,
      rngState,
      nextId,
    },
    cues: [CUES.deal],
  };
}

/** Four empty foundations. */
export function emptyFoundations(): readonly (readonly CardState[])[] {
  return Array.from({ length: FOUNDATION_COUNT }, () => []);
}

/** Seven empty columns. */
export function emptyTableau(): readonly (readonly CardState[])[] {
  return Array.from({ length: TABLEAU_COLUMNS }, () => []);
}

/**
 * A fresh game on the table: the deal, on the `playing` screen, with nothing in
 * hand and the victory cascade wound back. This is what the `NEW GAME` controls
 * and a press on the won screen do (specs/screens.md, specs/victory.md).
 */
export function newGame(state: CascadeState): Outcome {
  const dealt = deal(state);
  return {
    state: {
      ...dealt.state,
      screen: "playing",
      drag: null,
      dropTarget: null,
      flyers: [],
      launchClock: 0,
      cascadeDone: false,
    },
    cues: dealt.cues,
  };
}

// ---- The stock -----------------------------------------------------------

/**
 * A turn of the stock, or a recycle when the stock is empty (specs/stock.md).
 *
 * A turn takes `TURN_COUNT` cards one at a time off the top of the stock, so the
 * last one taken is the waste's new top card, and appends one set holding
 * exactly them. A recycle returns the whole waste face-down in reverse order, so
 * the waste's bottom card is the stock's top, and empties the set memory with it.
 */
export function turnStock(state: CascadeState): Outcome {
  if (state.stock.length > 0) {
    const count = Math.min(TURN_COUNT, state.stock.length);
    const kept = state.stock.slice(0, state.stock.length - count);
    const turned = state.stock
      .slice(state.stock.length - count)
      .reverse()
      .map((card) => ({ ...card, faceUp: true }));
    return {
      state: {
        ...state,
        stock: kept,
        waste: [...state.waste, ...turned],
        wasteSets: appendWasteSet(state.wasteSets, count),
      },
      cues: [CUES.turn],
    };
  }

  if (state.waste.length === 0) return unchanged(state);

  return {
    state: {
      ...state,
      stock: [...state.waste].reverse().map((card) => ({
        ...card,
        faceUp: false,
      })),
      waste: [],
      wasteSets: [],
    },
    cues: [CUES.recycle],
  };
}

// ---- Moving a run --------------------------------------------------------

/**
 * The run a press or a move takes out of a pile, or `null` when that pile offers
 * the named card nothing (specs/tableau.md, specs/stock.md).
 */
export function liftableRun(
  state: CascadeState,
  ref: CardRef,
): readonly CardState[] | null {
  const cards = pileCards(state, ref.pile, ref.index);
  if (ref.row < 0 || ref.row >= cards.length) return null;
  switch (ref.pile) {
    case "stock":
      return null;
    case "waste":
      if (ref.row !== cards.length - 1) return null;
      if (shownWasteCount(state) <= 0) return null;
      return [cards[ref.row]];
    case "foundation":
      if (ref.row !== cards.length - 1) return null;
      return [cards[ref.row]];
    case "tableau":
      if (!cards[ref.row].faceUp) return null;
      return cards.slice(ref.row);
  }
}

/**
 * The state with a run taken off its pile and held nowhere.
 *
 * The waste's set memory is left exactly as it stands: a set's count falls only
 * when its card leaves the waste for good, which is what makes a lifted card
 * that comes back find the memory as it was (specs/stock.md).
 */
export function detachRun(
  state: CascadeState,
  ref: CardRef,
  count: number,
): CascadeState {
  const cards = pileCards(state, ref.pile, ref.index);
  return withPile(
    state,
    ref.pile,
    ref.index,
    cards.slice(0, cards.length - count),
  );
}

/** Whether the pile named by `to` accepts the run offered to it. */
export function accepts(
  state: CascadeState,
  cards: readonly CardState[],
  to: PileRef,
): boolean {
  const pile = pileCards(state, to.pile, to.index);
  switch (to.pile) {
    case "foundation":
      return foundationAccepts(pile, cards);
    case "tableau":
      return tableauAccepts(pile, cards);
    case "stock":
    case "waste":
      return false;
  }
}

/**
 * Land a run the target has already accepted, and run everything that follows:
 * the waste's set memory shrinking, a newly exposed column card turning, and the
 * win.
 *
 * `state` is the state with the run already off its source, so this is equally
 * the end of a released drag and the end of a move driven from code.
 */
export function landRun(
  state: CascadeState,
  from: PileRef,
  cards: readonly CardState[],
  to: PileRef,
): Outcome {
  const cues: CueName[] = [];

  let next = withPile(state, to.pile, to.index, [
    ...pileCards(state, to.pile, to.index),
    ...cards,
  ]);

  if (from.pile === "waste") {
    let sets = next.wasteSets;
    for (let i = 0; i < cards.length; i++) sets = dropFromNewestSet(sets);
    next = { ...next, wasteSets: sets };
  }

  if (to.pile === "foundation") cues.push(CUES.home);

  if (from.pile === "tableau" && next.autoFlip) {
    const column = pileCards(next, from.pile, from.index);
    const lowest = column[column.length - 1];
    if (lowest !== undefined && !lowest.faceUp) {
      next = withPile(next, from.pile, from.index, [
        ...column.slice(0, column.length - 1),
        { ...lowest, faceUp: true },
      ]);
      cues.push(CUES.flip);
    }
  }

  const won = checkWin(next);
  next = won.state;
  cues.push(...won.cues);

  return { state: next, cues };
}

/**
 * The win, when every card is home and win detection is on (specs/victory.md).
 *
 * The cascade begins with it: the launch clock holds `LAUNCH_INTERVAL`, so the
 * first card launches on the cascade's first frame.
 */
export function checkWin(state: CascadeState): Outcome {
  if (state.screen === "won") return unchanged(state);
  if (!state.winDetect || !boardComplete(state.foundations)) {
    return unchanged(state);
  }
  return {
    state: {
      ...state,
      screen: "won",
      drag: null,
      dropTarget: null,
      launchClock: LAUNCH_INTERVAL,
      launched: 0,
      flyers: [],
      cascadeDone: false,
    },
    cues: [CUES.win],
  };
}

/**
 * A whole move, source to target, decided by the game's own rules
 * (specs/instrumentation.md).
 *
 * A refused move leaves the board exactly as it was.
 */
export function moveRun(
  state: CascadeState,
  from: CardRef,
  to: PileRef,
): MoveOutcome {
  const cards = liftableRun(state, from);
  if (cards === null) return { state, accepted: false, cues: [] };

  const detached = detachRun(state, from, cards.length);
  if (!accepts(detached, cards, to)) {
    return { state, accepted: false, cues: [] };
  }

  const landed = landRun(detached, from, cards, to);
  return { state: landed.state, accepted: true, cues: landed.cues };
}

/**
 * The auto-move: the named pile's playable card to the foundation it belongs on
 * (specs/instrumentation.md, specs/controls.md).
 *
 * The playable card is the waste's top card or a column's lowest face-up card. A
 * pile that holds none of those sends nothing.
 */
export function autoMove(
  state: CascadeState,
  pile: CardRef["pile"],
  index: number,
): MoveOutcome {
  const ref = playableCard(state, pile, index);
  if (ref === null) return { state, accepted: false, cues: [] };

  const cards = pileCards(state, ref.pile, ref.index);
  const target = foundationFor(state.foundations, cards[ref.row]);
  if (target < 0) return { state, accepted: false, cues: [] };

  return moveRun(state, ref, { pile: "foundation", index: target });
}

/**
 * The card a double click or an auto-move acts on: the waste's top card, or a
 * column's lowest face-up card.
 */
export function playableCard(
  state: CascadeState,
  pile: CardRef["pile"],
  index: number,
): CardRef | null {
  const cards = pileCards(state, pile, index);
  if (cards.length === 0) return null;
  if (pile === "waste") {
    if (shownWasteCount(state) <= 0) return null;
    return { pile, index, row: cards.length - 1 };
  }
  if (pile === "tableau") {
    if (!cards[cards.length - 1].faceUp) return null;
    return { pile, index, row: cards.length - 1 };
  }
  return null;
}
