// foundations/build-up-same-suit — a foundation takes the next card up in its
// own suit.
//
// `specs/foundations.md`, the acceptance table: a foundation whose "top card
// being rank `r` of suit `s`" accepts "The card of rank `r + 1` and suit `s`".
// This check decides that row in the accepting direction; the three refusing
// directions are `reject-off-suit`, `reject-rank-gap` and `reject-lower-rank`.
//
// THE FOUNDATION IS POSED MID-BUILD RATHER THAN AT THE ACE, so what is decided
// here is the general rule rather than the empty-foundation rule
// `ace-starts-empty` already decides. `poseFoundation` lays the Ace through the
// five of spades, which is the only shape a legal foundation has
// (`specs/foundations.md`: it "builds one suit upward from Ace to King"), and
// the six of spades is offered from an otherwise empty table.
//
// THE READING IS THE FOUNDATION'S HEIGHT AND THE CARD ON TOP, BY ID. Six cards
// with the offered card last is the pass. Five is a build that refused. Six with
// some other card on top is a build that reordered the pile it was appending to,
// which `specs/instrumentation.md` fixes as bottom to top.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  poseFoundation,
  whereIs,
  type Harness,
} from "../harness";

/** The foundation under test, and the suit it is locked to. */
const FOUNDATION = 0;
const SUIT = "spades" as const;

/** How high the foundation is built before the offer: the Ace through the five. */
const BUILT_TO = 5;

/** The column the next card up is offered from. */
const COLUMN = 0;

/** The card offered: rank `BUILT_TO + 1` of the foundation's own suit. */
const OFFERED = card("6S");

/** One frame, so the still shows the board the accepted move left. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("accepts the next-higher card of its own suit onto its top card", async () => {
  await openTable(h);
  await poseFoundation(h, FOUNDATION, SUIT, BUILT_TO);
  const [offeredId] = await poseColumn(h, COLUMN, [OFFERED]);

  const accepted = await h.debug.move(
    "tableau",
    COLUMN,
    0,
    "foundation",
    FOUNDATION,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "accepted");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    true,
    `move's verdict on the ${SUIT} ${OFFERED.rank} offered to a ${SUIT} ` +
      `foundation topped by the ${BUILT_TO} — specs/foundations.md accepts ` +
      "the card of rank r + 1 and the same suit",
  );
  assertDeepEqual(
    whereIs(after, offeredId),
    { pile: "foundation", index: FOUNDATION, row: BUILT_TO },
    `where the ${OFFERED.rank} (id ${offeredId}) sits after the move — it is ` +
      `the foundation's new top card, above the ${BUILT_TO} cards already ` +
      "there. specs/instrumentation.md orders a pile bottom to top",
  );
  assertLength(
    pileOf(after, "foundation", FOUNDATION),
    BUILT_TO + 1,
    `the cards on foundation ${FOUNDATION} after the move`,
  );
  assertLength(
    pileOf(after, "tableau", COLUMN),
    0,
    `the cards left in column ${COLUMN}, which held nothing but the offer`,
  );
});
