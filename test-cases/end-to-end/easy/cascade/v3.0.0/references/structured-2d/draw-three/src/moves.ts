// Cascade — moving cards: the one path every move runs down.
//
// A move has two halves. LIFTING takes a run out of the pile that holds it, by
// the rules `specs/tableau.md` and `specs/stock.md` fix for what a pile offers.
// LANDING offers that run to a target, by the rules `specs/foundations.md` and
// `specs/tableau.md` fix for what a pile accepts, and either lands it or returns
// it to where it came from with every face unchanged.
//
// A released drop, a `move` driven from code and the auto-move are all the same
// two halves in the same order, so the turning of a newly exposed card, the cue
// a card reaching home raises, and the win a completed board reaches are the
// same however the move was asked for. Nothing here reads the pointer and
// nothing here draws.
//
// The pointer path lifts on the PRESS and lands on the RELEASE, so the run is out
// of its pile for the length of a gesture; a `move` does both inside one call.
// That is why lifting and landing are separate functions rather than one.

import type { FrameEvents } from "./audio";
import { DECK_SIZE } from "./constants";
import { beginCascade } from "./cascade";
import type { CardState, CascadeState, PileKind } from "./game";
import { pileOf, takeFromWasteSets, topOf, wasteVisibleCount } from "./piles";
import { columnAccepts, foundationAccepts, foundationFor } from "./rules";

/** The pile a run was lifted from, which is where a refusal returns it. */
export interface MoveSource {
  pile: "waste" | "foundation" | "tableau";
  index: number;
}

/** A run out of its pile, and the pile it came out of. */
export interface LiftedRun {
  run: CardState[];
  from: MoveSource;
}

/**
 * Take a run out of a pile, or refuse.
 *
 * A column offers the named face-up card and every card below it, in the order
 * they lie there. The waste offers its top card alone, and only while its set
 * memory shows one. A foundation offers its top card alone. The stock offers
 * nothing, and neither does a face-down card.
 *
 * The waste's set memory is left exactly as it stands: a lifted card keeps its
 * place on its set for as long as it is in hand, and the count falls only when
 * the card leaves the waste for good (`specs/stock.md`).
 */
export function liftRun(
  state: CascadeState,
  pile: PileKind,
  index: number,
  row: number,
): LiftedRun | null {
  const cards = pileOf(state, pile, index);
  if (cards === null || pile === "stock") return null;
  if (!Number.isInteger(row) || row < 0 || row >= cards.length) return null;

  if (pile === "waste") {
    if (wasteVisibleCount(state) <= 0) return null;
    if (row !== cards.length - 1) return null;
  }
  if (pile === "foundation" && row !== cards.length - 1) return null;
  if (!cards[row].faceUp) return null;

  const run = cards.splice(row);
  return { run, from: { pile, index } };
}

/** Put a lifted run back where it came from, in the order it left. */
export function returnRun(state: CascadeState, lifted: LiftedRun): void {
  const cards = pileOf(state, lifted.from.pile, lifted.from.index);
  if (cards === null) return;
  cards.push(...lifted.run);
}

/** Whether a pile would accept a run lifted from `from`. */
export function accepts(
  state: CascadeState,
  run: readonly CardState[],
  from: MoveSource,
  toPile: PileKind,
  toIndex: number,
): boolean {
  const target = pileOf(state, toPile, toIndex);
  if (target === null || run.length === 0) return false;

  if (toPile === "foundation") {
    // A foundation takes exactly one card at a time and refuses a run, and it
    // accepts from a column and from the waste alone.
    if (run.length !== 1) return false;
    if (from.pile === "foundation") return false;
    return foundationAccepts(target, run[0]);
  }
  if (toPile === "tableau") {
    return columnAccepts(target, run);
  }
  // The stock and the waste accept nothing a move offers them.
  return false;
}

/**
 * Offer a lifted run to a target. An accepted run lands on it and the move's own
 * consequences follow: the waste's set gives up its card, a column left with a
 * face-down lowest card turns it, a foundation raises its cue, and a completed
 * board wins. A refused run goes back to the pile it was lifted from and nothing
 * else changes.
 */
export function landRun(
  state: CascadeState,
  lifted: LiftedRun,
  toPile: PileKind,
  toIndex: number,
  events: FrameEvents,
): boolean {
  if (!accepts(state, lifted.run, lifted.from, toPile, toIndex)) {
    returnRun(state, lifted);
    return false;
  }

  const target = pileOf(state, toPile, toIndex);
  if (target === null) {
    returnRun(state, lifted);
    return false;
  }
  target.push(...lifted.run);

  if (lifted.from.pile === "waste") takeFromWasteSets(state);
  if (lifted.from.pile === "tableau")
    flipExposed(state, lifted.from.index, events);
  if (toPile === "foundation") events.home = true;

  checkWin(state, events);
  return true;
}

/**
 * Turn a column's newly exposed lowest card face-up. Only that one card turns:
 * every face-down card above it stays face-down, and a move that leaves a
 * face-up card lowest, or empties the column, turns nothing.
 */
export function flipExposed(
  state: CascadeState,
  index: number,
  events: FrameEvents,
): void {
  if (!state.autoFlip) return;
  const column = state.tableau[index];
  if (column === undefined) return;
  const lowest = topOf(column);
  if (lowest === null || lowest.faceUp) return;
  lowest.faceUp = true;
  events.flip = true;
}

/** How many of the fifty-two cards are home. */
export function cardsHome(state: CascadeState): number {
  return state.foundations.reduce((total, pile) => total + pile.length, 0);
}

/**
 * The win: the instant all fifty-two cards are on the foundations the game moves
 * to the `won` screen and the cascade takes over. Play stops there.
 */
export function checkWin(state: CascadeState, events: FrameEvents): void {
  if (!state.winDetect) return;
  if (state.screen === "won") return;
  if (cardsHome(state) < DECK_SIZE) return;

  state.screen = "won";
  state.drag = null;
  state.dropTarget = null;
  events.win = true;
  beginCascade(state);
}

/**
 * A whole move, lifted and landed inside one call. It returns what the game's own
 * rules decided, and a refused move leaves the board exactly as it was.
 */
export function attemptMove(
  state: CascadeState,
  fromPile: PileKind,
  fromIndex: number,
  fromRow: number,
  toPile: PileKind,
  toIndex: number,
  events: FrameEvents,
): boolean {
  const lifted = liftRun(state, fromPile, fromIndex, fromRow);
  if (lifted === null) return false;
  return landRun(state, lifted, toPile, toIndex, events);
}

/**
 * The card a pile offers to be played: the waste's shown top card, or a column's
 * lowest face-up card. Every other pile offers none, which covers an empty pile,
 * a column whose lowest card is face-down, the stock and a foundation.
 */
export function playableRow(
  state: CascadeState,
  pile: PileKind,
  index: number,
): number {
  const cards = pileOf(state, pile, index);
  if (cards === null || cards.length === 0) return -1;
  if (pile === "waste") {
    return wasteVisibleCount(state) > 0 ? cards.length - 1 : -1;
  }
  if (pile === "tableau") {
    return cards[cards.length - 1].faceUp ? cards.length - 1 : -1;
  }
  return -1;
}

/**
 * Send a pile's playable card to the foundation it belongs on, when one accepts
 * it. It reports whether the card went home.
 */
export function autoMoveFrom(
  state: CascadeState,
  pile: PileKind,
  index: number,
  events: FrameEvents,
): boolean {
  const row = playableRow(state, pile, index);
  if (row < 0) return false;

  const cards = pileOf(state, pile, index);
  if (cards === null) return false;

  const target = foundationFor(state.foundations, cards[row]);
  if (target < 0) return false;

  return attemptMove(state, pile, index, row, "foundation", target, events);
}
