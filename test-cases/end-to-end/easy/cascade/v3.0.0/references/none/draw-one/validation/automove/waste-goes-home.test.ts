// automove/waste-goes-home — `autoMove("waste", 0)` sends the waste's top card
// to the foundation it belongs on, and answers `true`.
//
// `specs/instrumentation.md` fixes the operation: "sends the named pile's
// playable card to the foundation it belongs on when that is legal ... It
// returns `true` when the card went home", and "The playable card is the waste's
// top card". `specs/foundations.md` fixes which foundation that is: "the one
// already holding the next-lower card of its own suit".
//
// THE POSE IS WHAT MAKES THIS DECIDE SOMETHING. The waste holds two cards, so
// "the waste's top card" is a choice rather than a tautology, and the buried card
// belongs on no foundation this board carries: a build that reached for the
// waste's BOTTOM card would find nothing to send and answer `false`, rather than
// quietly passing on a one-card waste. The refusal direction of the same rule is
// `automove/illegal-does-nothing`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  cards,
  captureStill,
  createHarness,
  openTable,
  pileOf,
  poseFoundation,
  poseWaste,
  topOf,
  wasteTop,
  whereIs,
  type Harness,
} from "../harness";

/**
 * The foundation the hearts are built on, and how far up it stands.
 *
 * `specs/foundations.md`: "Any suit may be started on any empty foundation, so
 * the suits are not tied to fixed slots." Hearts therefore sit on foundation
 * `2` rather than on a slot a suit order would predict, which is what keeps this
 * check honest about "the foundation it belongs on" rather than about an index.
 */
const HEARTS_FOUNDATION = 2;
const HEARTS_UP_TO = 5;

/** The card the waste shows: rank `r + 1` of the foundation's suit. */
const SENT = "6H";

/** The card squared away behind it, which belongs on no foundation here. */
const BURIED = "3C";

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sends the waste's top card to its own suit's foundation and says so", async () => {
  await openTable(h);
  await poseFoundation(h, HEARTS_FOUNDATION, "hearts", HEARTS_UP_TO);
  const [buriedId, sentId] = await poseWaste(h, cards(BURIED, SENT), [1, 1]);

  // The card the operation is about really is the one the waste is showing.
  assertEqual(
    wasteTop(await h.snapshot())?.id,
    sentId,
    "the waste's top card before the auto-move",
  );

  const went = await h.debug.autoMove("waste", 0);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "home");

  assertEqual(went, true, "the verdict autoMove returned");

  const after = await h.snapshot();
  assertDeepEqual(
    whereIs(after, sentId),
    { pile: "foundation", index: HEARTS_FOUNDATION, row: HEARTS_UP_TO },
    "where the waste's top card ended up",
  );
  assertDeepEqual(
    pileOf(after, "foundation", HEARTS_FOUNDATION).map((c) => [c.suit, c.rank]),
    [
      ["hearts", 1],
      ["hearts", 2],
      ["hearts", 3],
      ["hearts", 4],
      ["hearts", 5],
      ["hearts", 6],
    ],
    "the hearts foundation after the auto-move",
  );

  // And it LEFT the waste, which still holds the card that was behind it.
  assertLength(after.waste, 1, "the cards left on the waste");
  assertEqual(
    topOf(after.waste)?.id,
    buriedId,
    "the card the waste is left holding",
  );
});
