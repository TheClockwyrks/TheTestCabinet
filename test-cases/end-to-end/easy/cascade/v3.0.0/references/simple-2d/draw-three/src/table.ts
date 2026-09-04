// Cascade — what the table does: the deal, the stock, and every move.
//
// Every rule here is stated by one of `specs/deal.md`, `specs/stock.md`,
// `specs/foundations.md` and `specs/tableau.md`, and every route into a move —
// a released drop, a double click's auto-move, and the debug surface's `move` —
// runs through the same three steps: take a run out of a pile, ask the target
// whether it accepts it, and land it. That is what makes a scenario driven from
// code behave exactly like one played by hand.
//
// Every function takes the `Sim` the transition is being built in and writes to
// it. Nothing here draws, reads a clock, or touches the engine.

import {
  CUES,
  DECK_SIZE,
  DEAL_TABLEAU_CARDS,
  FOUNDATION_COUNT,
  LAUNCH_INTERVAL,
  TABLEAU_COLUMNS,
  TURN_COUNT,
} from "./constants";
import { buildDeck, columnAccepts, foundationAccepts } from "./cards";
import { leadingCenter, zoneAt } from "./layout";
import { shuffleInPlace } from "./rng";
import {
  pileOf,
  raise,
  takeId,
  visibleCount,
  type MutCard,
  type Sim,
} from "./sim";
import type { PileKind } from "./game";

/** A pile a run can be taken from or landed on. */
export interface PileRef {
  readonly pile: PileKind;
  readonly index: number;
}

// ---- The waste's set memory (specs/stock.md) ------------------------------

/**
 * Take `count` cards off the waste's set memory, newest set first.
 *
 * A set played off entirely leaves the memory, so the waste falls back to what
 * is left of the set turned before it. This is the rule play itself follows, and
 * `removeCard` on the debug surface follows it too.
 */
export function dropFromWasteSets(sim: Sim, count: number): void {
  for (let n = 0; n < count; n++) {
    while (
      sim.wasteSets.length > 0 &&
      (sim.wasteSets[sim.wasteSets.length - 1] as number) <= 0
    ) {
      sim.wasteSets.pop();
    }
    const newest = sim.wasteSets.length - 1;
    if (newest < 0) return;
    sim.wasteSets[newest] = (sim.wasteSets[newest] as number) - 1;
    if ((sim.wasteSets[newest] as number) <= 0) sim.wasteSets.pop();
  }
}

// ---- The deal (specs/deal.md) ---------------------------------------------

/** Empty all thirteen piles and the waste's set memory. */
export function clearTable(sim: Sim): void {
  sim.stock = [];
  sim.waste = [];
  sim.wasteSets = [];
  sim.foundations = sim.foundations.map(() => []);
  sim.tableau = sim.tableau.map(() => []);
}

/**
 * Deal a fresh game from the seeded generator (`specs/deal.md`).
 *
 * Twenty-eight cards go to the seven columns, one to the first and seven to the
 * last, each column's last-dealt card face-up; the remaining twenty-four form the
 * stock, face-down, in the order the deal left them. The waste, its sets and the
 * four foundations start empty, and a new deal clears the painted table.
 */
export function dealFresh(sim: Sim): void {
  const deck = buildDeck();
  sim.rngState = shuffleInPlace(deck, sim.rngState);

  clearTable(sim);

  let cursor = 0;
  for (let column = 0; column < TABLEAU_COLUMNS; column++) {
    const cards: MutCard[] = [];
    for (let i = 0; i <= column; i++) {
      const face = deck[cursor++];
      if (face === undefined) break;
      cards.push({
        id: takeId(sim),
        suit: face.suit,
        rank: face.rank,
        faceUp: i === column,
      });
    }
    sim.tableau[column] = cards;
  }

  const stock: MutCard[] = [];
  for (let i = DEAL_TABLEAU_CARDS; i < deck.length; i++) {
    const face = deck[i];
    if (face === undefined) continue;
    stock.push({
      id: takeId(sim),
      suit: face.suit,
      rank: face.rank,
      faceUp: false,
    });
  }
  sim.stock = stock;

  sim.launched = 0;
  clearTrail(sim);
  raise(sim, CUES.deal);
}

/** Erase the painted layer and the count of what it holds. */
export function clearTrail(sim: Sim): void {
  sim.trail.clear();
  sim.trailStamps = 0;
}

/** Deal a fresh game and put the player on the table (`specs/screens.md`). */
export function newGame(sim: Sim): void {
  sim.drag = null;
  sim.dropTarget = null;
  sim.flyers = [];
  sim.launched = 0;
  sim.launchClock = 0;
  sim.cascadeDone = false;
  dealFresh(sim);
  sim.screen = "playing";
  // "Every deal that begins play selects the first of them, so `menuIndex` is
  // `0` when a fresh game starts" (specs/screens.md).
  sim.menuIndex = 0;
}

// ---- The stock (specs/stock.md) -------------------------------------------

/**
 * Turn the stock, or recycle it when it is empty.
 *
 * A turn moves `TURN_COUNT` cards, or all that remain, one at a time off the top
 * of the stock and face-up onto the waste, and appends one set holding exactly
 * those cards. A turn of an empty stock returns the whole waste face-down in
 * reverse order, so a further pass turns the same cards up in the same order, and
 * empties the set memory with it.
 */
export function turnStock(sim: Sim): void {
  if (sim.stock.length > 0) {
    const count = Math.min(TURN_COUNT, sim.stock.length);
    for (let i = 0; i < count; i++) {
      const card = sim.stock.pop() as MutCard;
      card.faceUp = true;
      sim.waste.push(card);
    }
    sim.wasteSets.push(count);
    raise(sim, CUES.turn);
    return;
  }

  if (sim.waste.length === 0) return;

  const returning = sim.waste.slice().reverse();
  for (const card of returning) card.faceUp = false;
  sim.stock = returning;
  sim.waste = [];
  sim.wasteSets = [];
  raise(sim, CUES.recycle);
}

// ---- Moves (specs/foundations.md, specs/tableau.md) -----------------------

/**
 * The run a grab at `row` takes out of a pile, or `null` where nothing may be
 * taken (`specs/controls.md`).
 *
 * Nothing leaves the pile here; this only decides what would.
 */
export function grabbableRun(
  sim: Sim,
  pile: PileKind,
  index: number,
  row: number,
): MutCard[] | null {
  const cards = pileOf(sim, pile, index);
  if (cards === null) return null;
  if (!Number.isInteger(row) || row < 0 || row >= cards.length) return null;

  switch (pile) {
    case "stock":
      return null;
    case "waste":
      if (row !== cards.length - 1) return null;
      if (visibleCount(sim.wasteSets) <= 0) return null;
      return [cards[row] as MutCard];
    case "foundation":
      if (row !== cards.length - 1) return null;
      return [cards[row] as MutCard];
    case "tableau": {
      const run = cards.slice(row);
      if (run.some((card) => !card.faceUp)) return null;
      return run;
    }
  }
}

/** Whether the pile `pile`/`index` accepts `run`. */
export function acceptsRun(
  sim: Sim,
  pile: PileKind,
  index: number,
  run: readonly MutCard[],
): boolean {
  const cards = pileOf(sim, pile, index);
  if (cards === null || run.length === 0) return false;
  if (pile === "foundation") return foundationAccepts(cards, run);
  if (pile === "tableau") return columnAccepts(cards, run);
  return false;
}

/** The foundation `card` belongs on, or `null` when none accepts it. */
export function foundationFor(sim: Sim, card: MutCard): number | null {
  for (let i = 0; i < FOUNDATION_COUNT; i++) {
    if (foundationAccepts(sim.foundations[i] as MutCard[], [card])) return i;
  }
  return null;
}

/** How many cards are home. */
export function cardsHome(sim: Sim): number {
  return sim.foundations.reduce((total, pile) => total + pile.length, 0);
}

/**
 * Land a run that has already left its source, and everything that follows from
 * an accepted move: the exposed card turns, the cue for a card reaching home
 * sounds, and a completed board wins.
 */
export function completeLanding(
  sim: Sim,
  run: MutCard[],
  from: PileRef,
  to: PileRef,
): void {
  const target = pileOf(sim, to.pile, to.index);
  if (target === null) return;
  for (const card of run) target.push(card);

  if (from.pile === "waste") dropFromWasteSets(sim, run.length);
  if (from.pile === "tableau" && sim.autoFlip) {
    const column = pileOf(sim, "tableau", from.index);
    const lowest = column?.[column.length - 1];
    if (lowest !== undefined && !lowest.faceUp) {
      lowest.faceUp = true;
      raise(sim, CUES.flip);
    }
  }
  if (to.pile === "foundation") raise(sim, CUES.home);

  checkWin(sim);
}

/**
 * Attempt a move and report what the rules decided
 * (`specs/instrumentation.md`).
 *
 * A refused move leaves the board exactly as it was.
 */
export function moveCards(
  sim: Sim,
  fromPile: PileKind,
  fromIndex: number,
  fromRow: number,
  toPile: PileKind,
  toIndex: number,
): boolean {
  if (fromPile === toPile && fromIndex === toIndex) return false;
  const source = pileOf(sim, fromPile, fromIndex);
  if (source === null) return false;
  if (pileOf(sim, toPile, toIndex) === null) return false;

  const run = grabbableRun(sim, fromPile, fromIndex, fromRow);
  if (run === null) return false;
  if (!acceptsRun(sim, toPile, toIndex, run)) return false;

  source.splice(fromRow);
  completeLanding(
    sim,
    run,
    { pile: fromPile, index: fromIndex },
    { pile: toPile, index: toIndex },
  );
  return true;
}

/**
 * Send the named pile's playable card to the foundation it belongs on
 * (`specs/controls.md`).
 *
 * The playable card is the waste's shown top card, or a column's lowest face-up
 * card. Anything else sends nothing.
 */
export function autoMoveFrom(sim: Sim, pile: PileKind, index: number): boolean {
  if (pile !== "waste" && pile !== "tableau") return false;
  const cards = pileOf(sim, pile, index);
  if (cards === null || cards.length === 0) return false;

  const row = cards.length - 1;
  const run = grabbableRun(sim, pile, index, row);
  if (run === null || run.length !== 1) return false;

  const home = foundationFor(sim, run[0] as MutCard);
  if (home === null) return false;

  cards.splice(row);
  completeLanding(
    sim,
    run,
    { pile, index },
    { pile: "foundation", index: home },
  );
  return true;
}

// ---- Winning (specs/victory.md) -------------------------------------------

/** Win the game when every card is home and win detection is on. */
export function checkWin(sim: Sim): void {
  if (!sim.winDetect) return;
  if (cardsHome(sim) !== DECK_SIZE) return;
  beginCascade(sim);
}

/** Move to the won screen and start the victory cascade. */
export function beginCascade(sim: Sim): void {
  sim.screen = "won";
  sim.drag = null;
  sim.dropTarget = null;
  sim.launched = 0;
  sim.launchClock = LAUNCH_INTERVAL;
  sim.cascadeDone = false;
  raise(sim, CUES.win);
}

// ---- The held run ---------------------------------------------------------

/** Put a held run back where it was lifted from, in the order it left. */
export function returnHeldRun(sim: Sim): void {
  const drag = sim.drag;
  if (drag === null) return;
  const source = pileOf(sim, drag.fromPile, drag.fromIndex);
  if (source !== null) for (const card of drag.cards) source.push(card);
  sim.drag = null;
  sim.dropTarget = null;
}

/**
 * Recompute the pile a release would land the held run on
 * (`specs/controls.md`).
 *
 * A pile is the drop target only while the release rule would resolve the run to
 * it and that pile accepts the run.
 */
export function refreshDropTarget(sim: Sim): void {
  sim.dropTarget = null;
  const drag = sim.drag;
  if (drag === null) return;
  const centre = leadingCenter(drag.x, drag.y);
  const zone = zoneAt(sim, centre.x, centre.y);
  if (zone === null) return;
  if (zone.pile !== "foundation" && zone.pile !== "tableau") return;
  if (!acceptsRun(sim, zone.pile, zone.index, drag.cards)) return;
  sim.dropTarget = { pile: zone.pile, index: zone.index };
}
