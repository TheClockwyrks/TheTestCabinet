// Cascade — moving cards: the one path every move runs down.
//
// A move has three parts, and both the pointer and the debug surface use the
// same three, so a scenario driven from code behaves exactly like one played by
// hand (specs/instrumentation.md):
//
//   takeRun    lifts a run out of the pile it was taken from, or refuses;
//   landRun    offers that run to a target, applying everything an accepted
//              move brings with it — the waste's set memory, the turning of a
//              newly exposed card, and the win;
//   returnRun  puts a refused run back where it came from, in its own order and
//              with every face unchanged.
//
// A press lifts with `takeRun` and holds the run for the length of the gesture,
// which is why the run has LEFT its pile while it is in hand
// (specs/controls.md); a release lands or returns it. The debug surface's
// `move` does all three in one call.

import { beginCascade } from "./cascade";
import type { FrameCues } from "./audio";
import type { CardState, CascadeState, PileKind } from "./game";
import { wasteVisibleCount } from "./layout";
import { dropWasteCard, pileArray } from "./piles";
import { boardComplete, columnAccepts, foundationAccepts, foundationFor } from "./rules";

/** The pile a run came from, as the drag reports it. */
export interface RunSource {
  pile: "waste" | "foundation" | "tableau";
  index: number;
}

/**
 * Lift a run out of a pile, or refuse and change nothing.
 *
 * A column gives up the card at `row` and every card below it, all of which
 * must be face-up: a face-down card is never moved and never read
 * (specs/tableau.md). The waste gives up its top card alone, and only while it
 * shows one; a waste whose set memory is empty offers none to play, whatever
 * cards it holds (specs/stock.md). A foundation gives up its top card alone.
 * The stock gives up nothing.
 */
export function takeRun(
  state: CascadeState,
  pile: PileKind,
  index: number,
  row: number,
): CardState[] | null {
  const cards = pileArray(state, pile, index);
  if (cards === null || row < 0 || row >= cards.length) return null;

  switch (pile) {
    case "stock":
      return null;
    case "waste":
      if (wasteVisibleCount(state) === 0) return null;
      if (row !== cards.length - 1) return null;
      return cards.splice(row, 1);
    case "foundation":
      if (row !== cards.length - 1) return null;
      return cards.splice(row, 1);
    case "tableau": {
      const run = cards.slice(row);
      if (run.some((card) => !card.faceUp)) return null;
      cards.splice(row, run.length);
      return run;
    }
  }
}

/** Put a refused run back on the pile it was lifted from, in the order it left. */
export function returnRun(
  state: CascadeState,
  run: readonly CardState[],
  source: RunSource,
): void {
  const cards = pileArray(state, source.pile, source.index);
  if (cards === null) return;
  cards.push(...run);
}

/**
 * Turn a column's newly exposed lowest card face-up, when the automatic flip is
 * on. Only that one card turns, and a column left showing a face-up card or
 * left empty turns nothing (specs/tableau.md).
 */
export function flipExposed(
  state: CascadeState,
  column: number,
  cues: FrameCues,
): void {
  if (!state.autoFlip) return;
  const cards = state.tableau[column];
  if (cards.length === 0) return;
  const lowest = cards[cards.length - 1];
  if (lowest.faceUp) return;
  lowest.faceUp = true;
  cues.flip = true;
}

/**
 * The win test, run after every accepted move: the game is won the instant all
 * fifty-two cards are home, and the victory cascade takes over from there
 * (specs/victory.md). `winDetect` gates the whole of it.
 */
export function checkWin(state: CascadeState, cues: FrameCues): void {
  if (!state.winDetect || !boardComplete(state)) return;
  state.screen = "won";
  state.dropTarget = null;
  beginCascade(state);
  cues.win = true;
}

/**
 * Offer a run to a target. Returns whether the target's own rules accepted it.
 *
 * An accepted move is a move like any other: a card that leaves the waste for
 * good comes off its set, a column left with a face-down lowest card turns it,
 * and a board completed to fifty-two wins the game. A refused move changes
 * nothing at all, and the caller is left holding the run.
 */
export function landRun(
  state: CascadeState,
  run: readonly CardState[],
  source: RunSource,
  targetPile: PileKind,
  targetIndex: number,
  cues: FrameCues,
): boolean {
  const target = pileArray(state, targetPile, targetIndex);
  if (target === null) return false;

  const accepted =
    targetPile === "foundation"
      ? foundationAccepts(target, run)
      : targetPile === "tableau"
        ? columnAccepts(target, run)
        : false;
  if (!accepted) return false;

  target.push(...run);
  if (source.pile === "waste") dropWasteCard(state);
  if (source.pile === "tableau") flipExposed(state, source.index, cues);
  if (targetPile === "foundation") cues.home = true;
  checkWin(state, cues);
  return true;
}

/**
 * A whole move, source to target, as the debug surface's `move` performs it:
 * lift, offer, and put back what was refused. Returns what the game's own rules
 * decided (specs/instrumentation.md).
 *
 * The gesture cues — `drop` and `reject` — belong to a released drag rather than
 * to a move, so they are not raised here; the cues an accepted move itself
 * raises, `home`, `flip` and `win`, are.
 */
export function applyMove(
  state: CascadeState,
  fromPile: PileKind,
  fromIndex: number,
  fromRow: number,
  toPile: PileKind,
  toIndex: number,
  cues: FrameCues,
): boolean {
  const run = takeRun(state, fromPile, fromIndex, fromRow);
  if (run === null) return false;
  const source: RunSource = {
    pile: fromPile as RunSource["pile"],
    index: fromIndex,
  };
  if (landRun(state, run, source, toPile, toIndex, cues)) return true;
  returnRun(state, run, source);
  return false;
}

/**
 * The pile's playable card: the waste's top card, or a column's lowest face-up
 * card. `null` for every other pile and for a pile that holds none
 * (specs/controls.md, specs/instrumentation.md).
 */
export function playableCard(
  state: CascadeState,
  pile: PileKind,
  index: number,
): { card: CardState; row: number } | null {
  if (pile === "waste") {
    if (index !== 0 || wasteVisibleCount(state) === 0) return null;
    const row = state.waste.length - 1;
    if (row < 0) return null;
    return { card: state.waste[row], row };
  }
  if (pile === "tableau") {
    const column = pileArray(state, pile, index);
    if (column === null || column.length === 0) return null;
    const row = column.length - 1;
    const card = column[row];
    return card.faceUp ? { card, row } : null;
  }
  return null;
}

/**
 * Send a pile's playable card to the foundation it belongs on, when one accepts
 * it. Returns whether the card went home (specs/instrumentation.md).
 */
export function autoMoveFrom(
  state: CascadeState,
  pile: PileKind,
  index: number,
  cues: FrameCues,
): boolean {
  const playable = playableCard(state, pile, index);
  if (playable === null) return false;
  const foundation = foundationFor(state, playable.card);
  if (foundation === null) return false;
  return applyMove(state, pile, index, playable.row, "foundation", foundation, cues);
}
