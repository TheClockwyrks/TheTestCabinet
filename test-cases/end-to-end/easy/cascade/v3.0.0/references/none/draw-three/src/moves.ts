// Cascade — every way a card moves.
//
// One path applies every move, whether it came from a released drop, from a
// double click, or from the debug surface's `move()`: a run is LIFTED off its
// source, OFFERED to a target, and either lands or is RETURNED to where it came
// from. That is what makes the surface honest — a posed move runs the same
// turning, the same win test and the same set bookkeeping a played one does
// (specs/instrumentation.md).
//
// The rules themselves are in `src/rules.ts`; the deal and the stock's turn are
// here because both are events of the game rather than questions about cards.

import type { Card } from "./cards";
import { makeDeck } from "./cards";
import {
  CUES,
  DECK_SIZE,
  LAUNCH_INTERVAL,
  TABLEAU_COLUMNS,
  TURN_COUNT,
} from "./constants";
import { raiseCue } from "./audio";
import { asTarget } from "./layout";
import { shuffle } from "./rng";
import {
  allHome,
  columnAccepts,
  foundationAccepts,
  foundationFor,
} from "./rules";
import {
  clearTable,
  clearTrail,
  pileOf,
  takeId,
  type CascadeState,
  type PileKind,
  type PileRef,
  type SourceKind,
} from "./state";
import {
  addWasteSet,
  clearWasteSets,
  takeFromNewestSet,
  wasteTop,
} from "./waste";

/** Where a run was lifted from, so a refusal can put it back. */
export interface RunSource {
  pile: SourceKind;
  index: number;
}

/**
 * Take a run off a pile, or refuse.
 *
 * The cards LEAVE the pile: a run in hand has left the pile it was lifted from,
 * and that pile holds only the cards left behind for as long as the gesture lasts
 * (specs/controls.md). The waste's set memory is deliberately untouched, because
 * a set's count falls only when its card leaves the waste for good
 * (specs/stock.md).
 */
export function liftRun(
  state: CascadeState,
  from: RunSource,
  row: number,
): Card[] | null {
  const pile = pileOf(state, from.pile, from.index);
  if (pile === null) return null;
  if (!Number.isInteger(row) || row < 0 || row >= pile.length) return null;

  if (from.pile === "waste") {
    // A waste showing no card offers none to play, whatever it holds, and only
    // its top card may ever be played.
    if (state.wasteSets.length === 0) return null;
    if (row !== pile.length - 1) return null;
  } else if (from.pile === "foundation") {
    if (row !== pile.length - 1) return null;
  } else if (!pile[row].faceUp) {
    return null;
  }

  return pile.splice(row);
}

/** Put a lifted run back where it came from, in the order it left. */
export function returnRun(
  state: CascadeState,
  cards: Card[],
  from: RunSource,
): void {
  const pile = pileOf(state, from.pile, from.index);
  if (pile === null) return;
  for (const card of cards) pile.push(card);
}

/** Whether a target would accept a lifted run. */
export function targetAccepts(
  state: CascadeState,
  cards: readonly Card[],
  target: PileRef,
): boolean {
  const pile = pileOf(state, target.pile, target.index);
  if (pile === null) return false;
  return target.pile === "foundation"
    ? foundationAccepts(pile, cards)
    : columnAccepts(pile, cards);
}

/**
 * Land a lifted run on a target, or refuse it.
 *
 * On acceptance the run lands in the order it left, so its leading card becomes
 * the target's new lowest card, and the move's consequences follow: the waste's
 * set memory loses the card that left it, a column left showing a face-down card
 * turns it, and a completed board wins.
 */
export function landRun(
  state: CascadeState,
  cards: Card[],
  from: RunSource,
  target: PileRef,
): boolean {
  if (!targetAccepts(state, cards, target)) return false;
  const pile = pileOf(state, target.pile, target.index);
  if (pile === null) return false;
  for (const card of cards) pile.push(card);

  if (from.pile === "waste") takeFromNewestSet(state);
  if (from.pile === "tableau") flipExposed(state, from.index);
  if (target.pile === "foundation") raiseCue(state, CUES.home);
  checkWin(state);
  return true;
}

/**
 * Turn a column's newly exposed lowest card face-up.
 *
 * Only that one card turns, and only when `autoFlip` is on: the gate holds the
 * faculty still for a scenario that did not ask for it
 * (specs/instrumentation.md).
 */
export function flipExposed(state: CascadeState, column: number): void {
  if (!state.autoFlip) return;
  const pile = state.tableau[column];
  if (pile === undefined || pile.length === 0) return;
  const lowest = pile[pile.length - 1];
  if (lowest.faceUp) return;
  lowest.faceUp = true;
  raiseCue(state, CUES.flip);
}

/**
 * Win the game when every card is home, and begin the victory cascade.
 *
 * Gated by `winDetect`, which gates this check and the move to the `won` screen
 * and nothing else.
 */
export function checkWin(state: CascadeState): void {
  if (!state.winDetect) return;
  if (state.screen === "won") return;
  if (!allHome(state.foundations)) return;
  state.screen = "won";
  beginCascade(state);
  raiseCue(state, CUES.win);
}

/**
 * Start the cascade's clock.
 *
 * The launch clock holds `LAUNCH_INTERVAL` when the cascade begins, so the first
 * card launches on the cascade's first frame (specs/victory.md).
 */
export function beginCascade(state: CascadeState): void {
  state.launchClock = LAUNCH_INTERVAL;
  state.launched = 0;
  state.launchCursor = 0;
  state.cascadeDone = false;
}

/**
 * Attempt a move, and report whether the game's own rules accepted it.
 *
 * `row` is the grabbed card's index in its pile counted from the bottom; the
 * grabbed card and every card below it move together as a run. A refused move
 * leaves the board exactly as it was.
 */
export function applyMove(
  state: CascadeState,
  fromPile: PileKind,
  fromIndex: number,
  fromRow: number,
  toPile: PileKind,
  toIndex: number,
): boolean {
  if (fromPile === "stock") return false;
  const target = asTarget(toPile, toIndex);
  if (target === null) return false;
  if (pileOf(state, target.pile, target.index) === null) return false;

  const from: RunSource = { pile: fromPile, index: fromIndex };
  const cards = liftRun(state, from, fromRow);
  if (cards === null) return false;
  if (landRun(state, cards, from, target)) return true;
  returnRun(state, cards, from);
  return false;
}

/**
 * The card a pile offers to an auto-move: the waste's top card, or a column's
 * lowest face-up card. Every other pile offers none.
 */
export function playableCard(
  state: CascadeState,
  pile: PileKind,
  index: number,
): { card: Card; row: number } | null {
  if (pile === "waste") {
    const card = wasteTop(state);
    return card === null ? null : { card, row: state.waste.length - 1 };
  }
  if (pile === "tableau") {
    const column = state.tableau[index];
    if (column === undefined || column.length === 0) return null;
    const card = column[column.length - 1];
    return card.faceUp ? { card, row: column.length - 1 } : null;
  }
  return null;
}

/**
 * Send a pile's playable card to the foundation it belongs on, and report
 * whether it went. A pile holding no playable card sends nothing.
 */
export function autoMove(
  state: CascadeState,
  pile: PileKind,
  index: number,
): boolean {
  const playable = playableCard(state, pile, index);
  if (playable === null) return false;
  const slot = foundationFor(state.foundations, playable.card);
  if (slot < 0) return false;
  const from: RunSource = { pile: pile as SourceKind, index };
  const cards = liftRun(state, from, playable.row);
  if (cards === null) return false;
  if (landRun(state, cards, from, { pile: "foundation", index: slot })) {
    return true;
  }
  returnRun(state, cards, from);
  return false;
}

/**
 * Deal a fresh game from a full deck shuffled uniformly at random.
 *
 * It replaces the contents of all thirteen piles, empties the waste's set memory,
 * sets `launched` to `0`, and clears the painted table, which is what a new deal
 * does (specs/deal.md). It changes no other field, the screen included.
 */
export function deal(state: CascadeState): void {
  const deck = shuffle(makeDeck(() => takeId(state)));
  clearTable(state);

  let cursor = 0;
  for (let column = 0; column < TABLEAU_COLUMNS; column += 1) {
    for (let n = 0; n <= column; n += 1) {
      const card = deck[cursor];
      cursor += 1;
      card.faceUp = n === column;
      state.tableau[column].push(card);
    }
  }
  for (; cursor < DECK_SIZE; cursor += 1) {
    const card = deck[cursor];
    card.faceUp = false;
    state.stock.push(card);
  }

  state.launched = 0;
  clearTrail(state);
  raiseCue(state, CUES.deal);
}

/**
 * Turn the stock, or recycle the waste back into it.
 *
 * A turn of a stock holding cards moves `TURN_COUNT` cards, or all that remain,
 * one at a time from the top, and appends the set they form. A turn of an empty
 * stock returns the whole waste face-down in reverse order and empties the set
 * memory with it. A turn with both empty leaves both empty.
 */
export function turnStock(state: CascadeState): void {
  if (state.stock.length === 0) {
    if (state.waste.length === 0) return;
    while (state.waste.length > 0) {
      const card = state.waste.pop() as Card;
      card.faceUp = false;
      state.stock.push(card);
    }
    clearWasteSets(state);
    raiseCue(state, CUES.recycle);
    return;
  }

  const count = Math.min(TURN_COUNT, state.stock.length);
  for (let i = 0; i < count; i += 1) {
    const card = state.stock.pop() as Card;
    card.faceUp = true;
    state.waste.push(card);
  }
  addWasteSet(state, count);
  raiseCue(state, CUES.turn);
}
