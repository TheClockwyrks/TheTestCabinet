// handling/double-click-empty-does-nothing — two quick presses on bare table
// leave the board exactly as it was.
//
// `specs/controls.md` fixes it: a press is a double click only when, among the
// three conditions, "it lands on a playable card", and "A playable card is the
// waste's top card or a column's lowest face-up card". It also fixes that "A
// press that lands on no card lifts nothing", so neither press picks anything up
// and the releases have nothing to return.
//
// WHERE THE PRESSES LAND, AND WHY THERE. `specs/table.md` states that "The gaps
// between the columns carry no pile and nothing card-sized is drawn in them", so
// the two presses land in the middle of the `22`-unit gap immediately beside a
// column that is holding a card the standing foundation would accept — the very
// card a double click one gap to the left would send home. A build that resolves
// a press to the nearest pile, or that answers a column's whole strip rather than
// its cards' footprints, sends that card home and fails; a build that tests the
// footprint leaves the board untouched.
//
// The two presses are `0.1` s of game time apart, a third of
// `DOUBLE_CLICK_WINDOW` (`0.30`), and land on the same point, so the window and
// the slop are both satisfied and the only condition left unmet is the one this
// item names.
//
// WHAT "UNCHANGED" MEANS HERE. Every one of the thirteen piles, the waste's set
// memory, the screen, and the hand, read before and after and compared entry for
// entry. The pointer and the last press are deliberately left out: the pointer
// path records both by `specs/instrumentation.md`, and a press that changes
// nothing on the board still happened.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import {
  card,
  captureStill,
  clickAt,
  createHarness,
  framesFor,
  openTable,
  poseColumn,
  poseFoundation,
  type CardView,
  type CascadeSnapshot,
  type Harness,
} from "../harness";
import { CARD_H, CARD_W, COLUMN_X, TABLEAU_Y } from "../constants";

/** The foundation standing beside the scenario, its suit, and how far up. */
const FOUNDATION = 2;
const SUIT = "hearts" as const;
const UP_TO = 5;

/** The column holding the one card a sloppy hit test could send home. */
const COLUMN = 0;
const PLAYABLE = "6H";

/** The column on the far side of the gap the presses land in. */
const BEYOND_GAP = 1;

/** Game time between the two presses, a third of `DOUBLE_CLICK_WINDOW`. */
const GAP_SECONDS = 0.1;

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

/** Every card of every pile, the set memory, the screen and the hand. */
function board(snapshot: CascadeSnapshot): unknown {
  const pile = (cards: readonly CardView[]): unknown[] =>
    cards.map((c) => [c.id, c.suit, c.rank, c.faceUp]);
  return {
    screen: snapshot.screen,
    stock: pile(snapshot.stock),
    waste: pile(snapshot.waste),
    wasteSets: [...snapshot.wasteSets],
    foundations: snapshot.foundations.map(pile),
    tableau: snapshot.tableau.map(pile),
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("changes nothing when two quick presses land on no card", async () => {
  await openTable(h);
  await poseFoundation(h, FOUNDATION, SUIT, UP_TO);
  await poseColumn(h, COLUMN, [card(PLAYABLE)]);

  await h.advance(SETTLE_FRAMES);
  const before = board(await h.snapshot());

  // The middle of the gap between the posed column and the next one, at the
  // height of the posed card.
  const pressX = (COLUMN_X[COLUMN] + CARD_W + COLUMN_X[BEYOND_GAP]) / 2;
  const pressY = TABLEAU_Y + CARD_H / 2;

  await clickAt(h, pressX, pressY);
  await h.advance(framesFor(GAP_SECONDS));
  await clickAt(h, pressX, pressY);

  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "unchanged");

  const after = await h.snapshot();
  assertDeepEqual(
    board(after),
    before,
    "the board after two quick presses on bare table",
  );
  assertNull(after.drag, "the hand after two presses that lifted nothing");
});
