// Cascade — the piles, and every move over them.
//
// The deal (`specs/deal.md`), the stock and the waste's set memory
// (`specs/stock.md`), what a move takes out of a column and what turns after it
// (`specs/tableau.md`), and the acceptance the target answers with
// (`src/rules.ts`). Everything a card does passes through this file, so the
// pointer (`src/controls.ts`) and the debug surface (`src/debug.ts`) drive the
// same rules and cannot drift apart.

import {
  CUES,
  DEAL_STOCK_CARDS,
  FOUNDATION_COUNT,
  LAUNCH_INTERVAL,
  RANK_MAX,
  TABLEAU_COLUMNS,
  TURN_COUNT,
} from "./constants";
import { orderedDeck } from "./deck";
import { shuffle } from "./rng";
import { foundationAccepts, foundationFor, tableauAccepts } from "./rules";
import { clearTable, clearTrail, type CascadeState } from "./state";
import type { Card, PileName, SourcePile, Suit, TargetPile } from "./types";

/** Where a move takes its run from. */
export interface SourceRef {
  pile: SourcePile;
  index: number;
  /** The grabbed card's place in its pile, counted from the bottom. */
  row: number;
}

/** Where a move puts its run. */
export interface TargetRef {
  pile: TargetPile;
  index: number;
}

/* ---- Reading the table --------------------------------------------------- */

/** The named pile, or `null` when the name and index address none. */
export function pileAt(
  state: CascadeState,
  pile: PileName,
  index: number,
): Card[] | null {
  if (!Number.isInteger(index) || index < 0) return null;
  switch (pile) {
    case "stock":
      return index === 0 ? state.stock : null;
    case "waste":
      return index === 0 ? state.waste : null;
    case "foundation":
      return index < FOUNDATION_COUNT ? state.foundations[index] : null;
    case "tableau":
      return index < TABLEAU_COLUMNS ? state.tableau[index] : null;
  }
}

/**
 * How many cards the waste is showing: the newest entry of its set memory, and
 * `0` when the memory is empty (`specs/stock.md`).
 */
export function wasteVisibleCount(state: CascadeState): number {
  const sets = state.wasteSets;
  return sets.length === 0 ? 0 : sets[sets.length - 1];
}

/**
 * The waste's top card, which is the only card on it that may be played.
 *
 * A waste whose set memory is empty shows no card and offers none, whatever
 * cards it still holds.
 */
export function wasteTopCard(state: CascadeState): Card | null {
  if (wasteVisibleCount(state) <= 0) return null;
  if (state.waste.length === 0) return null;
  return state.waste[state.waste.length - 1];
}

/** The card a pile offers the auto-move, or `null` when it offers none. */
export function playableCard(
  state: CascadeState,
  pile: PileName,
  index: number,
): Card | null {
  if (pile === "waste") return index === 0 ? wasteTopCard(state) : null;
  if (pile !== "tableau") return null;
  const column = pileAt(state, pile, index);
  if (column === null || column.length === 0) return null;
  const lowest = column[column.length - 1];
  return lowest.faceUp ? lowest : null;
}

/** Whether every card is home, which is the win (`specs/victory.md`). */
export function isWin(state: CascadeState): boolean {
  return state.foundations.every(
    (foundation) => foundation.length === RANK_MAX,
  );
}

/* ---- Building cards ------------------------------------------------------ */

/** One fresh card, taking the next id this game has to hand. */
export function makeCard(
  state: CascadeState,
  suit: Suit,
  rank: number,
  faceUp: boolean,
): Card {
  const card: Card = { id: state.nextId, suit, rank, faceUp };
  state.nextId += 1;
  return card;
}

/* ---- The waste's set memory ---------------------------------------------- */

/**
 * Take one card off the newest set that holds any, dropping a set that is left
 * holding nothing.
 *
 * This is the rule play itself follows, so the memory stays consistent after
 * any sequence of poses as well as after any sequence of moves.
 */
export function takeFromWasteSets(state: CascadeState): void {
  const sets = state.wasteSets;
  while (sets.length > 0 && sets[sets.length - 1] <= 0) sets.pop();
  if (sets.length === 0) return;
  sets[sets.length - 1] -= 1;
  if (sets[sets.length - 1] <= 0) sets.pop();
}

/* ---- The deal ------------------------------------------------------------ */

/**
 * Deal a fresh game from the seeded generator, as `specs/deal.md` states.
 *
 * It replaces the contents of all thirteen piles, empties the waste's set
 * memory, sets `launched` to `0`, and clears the painted layer, which is what a
 * new deal does. It changes no other field, the screen included.
 */
export function dealCards(state: CascadeState): void {
  const deck = shuffle(orderedDeck(), state);
  clearTable(state);
  let next = 0;
  for (let column = 0; column < TABLEAU_COLUMNS; column += 1) {
    for (let row = 0; row <= column; row += 1) {
      const entry = deck[next];
      next += 1;
      // Every card is face-down except the last one dealt into the column,
      // which is that column's lowest card on the table.
      state.tableau[column].push(
        makeCard(state, entry.suit, entry.rank, row === column),
      );
    }
  }
  for (let i = 0; i < DEAL_STOCK_CARDS; i += 1) {
    const entry = deck[next];
    next += 1;
    state.stock.push(makeCard(state, entry.suit, entry.rank, false));
  }
  state.launched = 0;
  clearTrail(state);
  state.cues.raise(CUES.deal);
}

/** Deal a fresh game and enter play, which is what every NEW GAME control does. */
export function startNewGame(state: CascadeState): void {
  state.drag = null;
  state.dropTarget = null;
  state.gesture = null;
  state.flyers.length = 0;
  state.launchClock = 0;
  state.cascadeDone = false;
  state.nextFoundation = 0;
  dealCards(state);
  state.screen = "playing";
}

/* ---- The stock ----------------------------------------------------------- */

/**
 * Turn the stock, as `specs/stock.md` states.
 *
 * A stock holding cards moves the turn count onto the waste, taken one at a
 * time from its top, and appends one set holding exactly those cards. An empty
 * stock recycles instead: the whole waste returns face-down in reverse order,
 * and the set memory is emptied with it.
 */
export function turnStock(state: CascadeState): void {
  if (state.stock.length > 0) {
    const count = Math.min(TURN_COUNT, state.stock.length);
    for (let i = 0; i < count; i += 1) {
      const card = state.stock.pop();
      if (card === undefined) break;
      card.faceUp = true;
      state.waste.push(card);
    }
    state.wasteSets.push(count);
    state.cues.raise(CUES.turn);
    return;
  }
  if (state.waste.length === 0) return;
  while (state.waste.length > 0) {
    const card = state.waste.pop();
    if (card === undefined) break;
    card.faceUp = false;
    state.stock.push(card);
  }
  state.wasteSets.length = 0;
  state.cues.raise(CUES.recycle);
}

/* ---- Moving a run -------------------------------------------------------- */

/**
 * The run a source names, without taking it off the table, or `null` when that
 * source offers nothing.
 */
export function runAt(state: CascadeState, source: SourceRef): Card[] | null {
  const pile = pileAt(state, source.pile, source.index);
  if (pile === null || pile.length === 0) return null;
  if (!Number.isInteger(source.row) || source.row < 0) return null;
  if (source.row >= pile.length) return null;
  if (source.pile === "waste") {
    // Only the waste's top card may be played, and only while its set memory
    // says the waste is showing one.
    const top = wasteTopCard(state);
    if (top === null || source.row !== pile.length - 1) return null;
    return [top];
  }
  if (source.pile === "foundation") {
    if (source.row !== pile.length - 1) return null;
    return [pile[source.row]];
  }
  // A move whose taken card is face-down is refused, and a face-down card is
  // never read.
  if (!pile[source.row].faceUp) return null;
  return pile.slice(source.row);
}

/** Whether a target accepts the run offered to it. */
export function accepts(
  state: CascadeState,
  target: TargetRef,
  cards: readonly Card[],
): boolean {
  const pile = pileAt(state, target.pile, target.index);
  if (pile === null) return false;
  return target.pile === "foundation"
    ? foundationAccepts(pile, cards)
    : tableauAccepts(pile, cards);
}

/**
 * Take the run off its source pile and hand it back.
 *
 * The waste's set memory is deliberately untouched: a lifted card keeps its
 * set's count for as long as it is in hand, and the count falls only when the
 * card leaves the waste for good (`specs/stock.md`).
 */
export function detachRun(
  state: CascadeState,
  source: { pile: SourcePile; index: number },
  count: number,
): Card[] {
  const pile = pileAt(state, source.pile, source.index);
  if (pile === null) return [];
  return pile.splice(pile.length - count, count);
}

/** Put a run back where it was lifted from, in the order it left. */
export function returnRun(
  state: CascadeState,
  source: { pile: SourcePile; index: number },
  cards: readonly Card[],
): void {
  const pile = pileAt(state, source.pile, source.index);
  if (pile === null) return;
  pile.push(...cards);
}

/**
 * Land a detached run on its target and run the bookkeeping an accepted move
 * owes: the waste's set memory, the newly exposed column card, and the win.
 */
export function landRun(
  state: CascadeState,
  source: { pile: SourcePile; index: number },
  target: TargetRef,
  cards: readonly Card[],
): void {
  const pile = pileAt(state, target.pile, target.index);
  if (pile === null) return;
  pile.push(...cards);
  if (source.pile === "waste") takeFromWasteSets(state);
  if (target.pile === "foundation") state.cues.raise(CUES.home);
  afterAcceptedMove(state, source);
}

/**
 * What every accepted move owes, whatever gesture drove it: the source column's
 * newly exposed card turns, and a completed board wins.
 *
 * Only the source column is looked at, because only it can have been left with
 * a face-down card lowest, and only that one card turns.
 */
export function afterAcceptedMove(
  state: CascadeState,
  source: { pile: SourcePile; index: number },
): void {
  if (state.autoFlip && source.pile === "tableau") {
    const column = state.tableau[source.index];
    const lowest = column[column.length - 1];
    if (lowest !== undefined && !lowest.faceUp) {
      lowest.faceUp = true;
      state.cues.raise(CUES.flip);
    }
  }
  if (state.winDetect && isWin(state)) winGame(state);
}

/**
 * The win: play stops, the game moves to the `won` screen, and the victory
 * cascade begins with its clock already at the launch interval so the first
 * card launches on its first frame (`specs/victory.md`).
 */
export function winGame(state: CascadeState): void {
  state.screen = "won";
  state.drag = null;
  state.dropTarget = null;
  state.gesture = null;
  state.flyers.length = 0;
  state.launched = 0;
  state.launchClock = LAUNCH_INTERVAL;
  state.cascadeDone = false;
  state.nextFoundation = 0;
  state.cues.raise(CUES.win);
}

/**
 * Attempt a real move and report what the rules decided.
 *
 * A refused move leaves the board exactly as it was; an accepted one applies
 * through the same path a released drop uses.
 */
export function moveRun(
  state: CascadeState,
  source: SourceRef,
  target: TargetRef,
): boolean {
  const cards = runAt(state, source);
  if (cards === null) return false;
  if (!accepts(state, target, cards)) return false;
  const detached = detachRun(state, source, cards.length);
  landRun(state, source, target, detached);
  return true;
}

/**
 * Send a pile's playable card to the foundation it belongs on, when that is
 * legal, and report whether it went.
 */
export function autoMove(
  state: CascadeState,
  pile: PileName,
  index: number,
): boolean {
  const card = playableCard(state, pile, index);
  if (card === null) return false;
  const foundation = foundationFor(state.foundations, card);
  if (foundation < 0) return false;
  const source = {
    pile: pile === "waste" ? ("waste" as const) : ("tableau" as const),
    index,
  };
  const detached = detachRun(state, source, 1);
  landRun(state, source, { pile: "foundation", index: foundation }, detached);
  return true;
}
