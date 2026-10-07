// handling/double-click-buried-waste-does-nothing — two quick presses over a
// waste holding no top card do nothing, even when a foundation is waiting for the
// card underneath.
//
// THE RULE. `specs/controls.md`, The double click: a press is a double click only
// when, among the three conditions, "it lands on a playable card", and "A playable
// card is the waste's top card or a column's lowest face-up card." Its press
// table says the same from the other side: "A card on the waste that is not its
// top card" lifts "Nothing". `specs/stock.md` fixes which card that is: "The
// waste shows the cards it holds from the newest set that still holds any, and
// the last of those cards is the waste's top card", and "Only the waste's top
// card may be played."
//
// HOW A WASTE COMES TO HOLD NO TOP CARD, AND WHY THE SCENARIO IS THIS ONE. A
// waste whose set memory is empty shows nothing — `specs/instrumentation.md`
// fixes `wasteVisibleCount` as "the newest set's count, and `0` when the memory is
// empty" — so every card it holds is a card that is not its top card, and that is
// the state this point drives. It is the one such state BOTH deal modes reach:
// where the waste shows a fan, an older card of the fan is drawn beside the top
// one and can be pressed directly, and where it shows a single card there is no
// point on the table that reaches anything behind it. Posing a fan a deal mode
// cannot produce would be grading a state the game never enters.
//
// AND THE FOUNDATION IS STANDING AND ONE RANK SHORT of the waste's uppermost
// card, which is what "even when that card's foundation would accept it" means: a
// build that ignores the memory and treats the pile's last card as playable has
// somewhere to send it, so it moves the card and fails here. A board on which
// nothing could move would pass this point for the wrong reason.
//
// THE WHOLE BOARD IS COMPARED, ids and all, so a build that moved something else
// is caught wherever it reached; and the hand is read, because the other way to
// answer this press wrongly is to lift the card.
//
// The two presses are `0.1` s of game time apart and land on the same point, so
// the window and the slop are both satisfied and the only condition left unmet is
// the one this item names.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  card,
  cardCenter,
  clickAt,
  createHarness,
  everyCard,
  framesFor,
  NINE,
  openTable,
  pileTopLeft,
  poseFoundation,
  poseWaste,
  SIX,
  TWO,
  up,
  type CascadeSnapshot,
  type Harness,
} from "../harness";

/** The foundation standing one rank short of the waste's uppermost card. */
const FOUNDATION = 2;
const SUIT = "hearts" as const;
const UP_TO = 5;

/**
 * The waste, bottom card first, laid with NO set memory.
 *
 * Its uppermost card is the six of hearts, which the foundation above would
 * accept — so a build that reads the pile rather than the memory has a move to
 * make.
 */
const WASTE = [
  up(card("clubs", TWO)),
  up(card("spades", NINE)),
  up(card("hearts", SIX)),
] as const;

/** Game time between the two presses, a third of `DOUBLE_CLICK_WINDOW` (`0.30`). */
const GAP_SECONDS = 0.1;

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

/** Every card on the board, by id and face, so any movement reads as a change. */
function board(s: CascadeSnapshot): string {
  return everyCard(s)
    .map((site) => site.card)
    .sort((a, b) => a.id - b.id)
    .map((c) => `${c.id}:${c.suit}-${c.rank}${c.faceUp ? "u" : "d"}`)
    .join(" ");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the waste alone when no card on it is its top card", async () => {
  openTable(h);
  await poseFoundation(h, FOUNDATION, SUIT, UP_TO);
  await poseWaste(h, [...WASTE], []);

  const before = h.snapshot();
  assertEqual(
    before.wasteVisibleCount,
    0,
    `posing: the cards the waste shows with an empty set memory — a waste ` +
      `that still has a top card would leave this point grading a playable ` +
      `card (specs/stock.md, specs/instrumentation.md)`,
  );
  const standing = board(before);

  const at = pileTopLeft("waste");
  const press = cardCenter(at.x, at.y);
  clickAt(h, press.x, press.y);
  await h.advance(1);
  await h.advance(framesFor(GAP_SECONDS));
  clickAt(h, press.x, press.y);
  await h.advance(1);

  await h.advance(SETTLE_FRAMES);
  const after = h.snapshot();
  // Before the assertions, so a build that sent the card home still leaves the
  // picture of the board it made.
  captureStill(h, "unchanged");

  assertEqual(
    board(after),
    standing,
    `the cards on the board after two quick presses over a waste holding no ` +
      `top card, against the board they were posed on — a double click lands ` +
      `on a playable card, and a card on the waste that is not its top card is ` +
      `not one (specs/controls.md)`,
  );
  assertEqual(
    after.drag,
    null,
    "the run in hand after those presses — a card on the waste that is not " +
      "its top card lifts nothing (specs/controls.md)",
  );
});
