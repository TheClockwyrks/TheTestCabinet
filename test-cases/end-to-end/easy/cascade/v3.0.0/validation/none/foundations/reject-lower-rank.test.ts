// foundations/reject-lower-rank — a foundation refuses a card of its own suit
// below its top rank.
//
// `specs/foundations.md`: a foundation topped by "rank `r` of suit `s`" accepts
// "The card of rank `r + 1` and suit `s`", and "refuses every other card offered
// to it". The offer here is of the foundation's own suit, so the suit rule
// cannot be what refuses it, and it is BELOW the top rather than above it, so it
// separates a build that compares the two ranks with a DIFFERENCE from one that
// compares them with an ORDER.
//
// THE WRONG MODELS, AND HOW EACH READS. A build testing `|offered - top| === 1`
// takes the four and the foundation reads six cards topped by a four — a
// foundation that is no longer the ascending run `specs/foundations.md`
// describes. A build testing only "same suit" takes it too. A build testing
// `offered !== top` takes it. Only `offered === top + 1` refuses it, which is
// the rule as written.
//
// THE OFFERED CARD IS A SECOND COPY OF ONE ALREADY HOME, AND THAT IS THE ONLY
// POSE THIS DIRECTION HAS. A legal foundation holds its Ace through its top card
// (`specs/foundations.md`: it "builds one suit upward from Ace to King"), so
// every card of its suit below its top is on it already, and a card that is both
// of the foundation's suit and below its top can only be a second copy. The
// debug surface poses cards one at a time and takes each on its own terms
// (`specs/instrumentation.md`: `addCard` "Adds one card of `suit` ... and
// `rank`"), and the acceptance rule is stated over the offered card's rank and
// suit and the foundation's top card alone, with no clause about the rest of the
// deck. So a build that answers this offer by the stated rule refuses it, and
// nothing here asks a build to police a deck the specification never mentions.

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
  topOf,
  whereIs,
  type Harness,
} from "../harness";

/** The foundation under test, and the suit it is locked to. */
const FOUNDATION = 0;
const SUIT = "spades" as const;

/** How high the foundation is built: the Ace through the five of spades. */
const BUILT_TO = 5;

/** The column the low card is offered from. */
const COLUMN = 0;

/** The offer: the foundation's own suit, one rank BELOW its top card. */
const OFFERED = card("4S");

/** One frame, so the still shows the board the refusal left. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("refuses a card of its own suit below its top rank", async () => {
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
  await captureStill(h, "refused");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    false,
    `move's verdict on the ${SUIT} ${OFFERED.rank} offered to a ${SUIT} ` +
      `foundation topped by the ${BUILT_TO} — specs/foundations.md accepts ` +
      `rank ${BUILT_TO + 1} of that suit and nothing else, so a card below ` +
      "the top is refused as surely as one above it",
  );
  assertLength(
    pileOf(after, "foundation", FOUNDATION),
    BUILT_TO,
    `the cards on foundation ${FOUNDATION} after the offer — ` +
      `${BUILT_TO + 1} is a build comparing the two ranks by difference ` +
      "rather than by order",
  );
  assertEqual(
    topOf(pileOf(after, "foundation", FOUNDATION))?.rank,
    BUILT_TO,
    `the rank of foundation ${FOUNDATION}'s top card after the offer`,
  );
  assertDeepEqual(
    whereIs(after, offeredId),
    { pile: "tableau", index: COLUMN, row: 0 },
    `where the ${OFFERED.rank} (id ${offeredId}) sits after its refusal — ` +
      "specs/tableau.md: a refused move changes nothing",
  );
});
