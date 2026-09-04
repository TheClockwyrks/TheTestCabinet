// stock/waste-top-to-foundation — the waste's top card can be played onto a
// foundation that accepts it, and it LEAVES the waste when it goes.
//
// `specs/stock.md`: "Only the waste's top card may be played, onto a foundation
// that accepts it by `specs/foundations.md` or onto a column that accepts it by
// `specs/tableau.md`." This is the acceptance direction of that sentence for a
// foundation; the column half is `stock.waste-top-to-tableau`, and the refusal
// of any other card on the waste is `stock.only-top-playable`.
//
// THE CARD THAT GOES IS THE TOP ONE, and the waste holds a second card so that
// is a choice. The buried card is the three of clubs, which the hearts
// foundation under test refuses whatever else is true (`specs/foundations.md`
// locks a foundation to the suit of its Ace), so a build that reached past the
// top card of the waste reads as a REFUSED move rather than as a lucky pass.
//
// THE FOUNDATION IS SLOT 2 rather than the slot a suit order would predict,
// because `specs/foundations.md` ties no suit to a slot: "Any suit may be
// started on any empty foundation."
//
// THE READING IS BOTH PILES. The six of hearts standing on its foundation, and
// the waste holding only the card that was behind it. A build that landed the
// card without taking it off its source has it in both places, which the waste's
// length catches.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  cards,
  createHarness,
  openTable,
  pileOf,
  poseFoundation,
  poseWaste,
  topOf,
  whereIs,
  type Harness,
} from "../harness";
import { turnCount, turnSets } from "./turns";

/** The foundation the waste's card belongs on, and how far up it stands. */
const FOUNDATION = 2;
const SUIT = "hearts" as const;
const UP_TO = 5;

/** The waste, bottom card first: a card the foundation refuses, then the one it takes. */
const WASTE = ["3C", "6H"];
const TOP_ROW = WASTE.length - 1;

/** One frame, so the still carries the waste's card on its foundation. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("plays the waste's top card onto a foundation that accepts it", async () => {
  await openTable(h);
  const count = turnCount(await h.snapshot());
  await poseFoundation(h, FOUNDATION, SUIT, UP_TO);
  const [buriedId, topId] = await poseWaste(
    h,
    cards(...WASTE),
    turnSets(WASTE.length, count),
  );

  const played = await h.debug.move(
    "waste",
    0,
    TOP_ROW,
    "foundation",
    FOUNDATION,
  );
  await h.advance(DRAW_FRAMES);
  await captureStill(h, "accepted");

  assertEqual(
    played,
    true,
    `move's verdict on the waste's ${WASTE[TOP_ROW]} offered to a ${SUIT} ` +
      `foundation whose top card is the ${UP_TO} — specs/stock.md lets the ` +
      "waste's top card be played onto a foundation that accepts it, and " +
      "specs/foundations.md accepts the next card up in the same suit",
  );

  const after = await h.snapshot();
  assertDeepEqual(
    whereIs(after, topId),
    { pile: "foundation", index: FOUNDATION, row: UP_TO },
    `where the ${WASTE[TOP_ROW]} (id ${topId}) sits after the move — it is ` +
      `foundation ${FOUNDATION}'s new top card`,
  );
  assertLength(
    pileOf(after, "foundation", FOUNDATION),
    UP_TO + 1,
    `the cards on foundation ${FOUNDATION} after the move`,
  );
  assertLength(
    after.waste,
    WASTE.length - 1,
    "the cards left on the waste — the card went home, so it left the waste " +
      "rather than being copied off it",
  );
  assertEqual(
    topOf(after.waste)?.id,
    buriedId,
    `the card the waste is left holding, which is the ${WASTE[0]} that was ` +
      "behind the one that went",
  );
});
