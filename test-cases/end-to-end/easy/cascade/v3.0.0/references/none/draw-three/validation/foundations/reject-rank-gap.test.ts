// foundations/reject-rank-gap — a foundation refuses a card of its own suit
// that skips a rank.
//
// `specs/foundations.md`: a foundation topped by "rank `r` of suit `s`" accepts
// "The card of rank `r + 1` and suit `s`", and "refuses every other card offered
// to it". The card offered here is of the foundation's own suit, so the suit
// rule cannot be what refuses it: the rank is the only thing left to decide the
// move.
//
// THE OFFER IS TWO RANKS ABOVE THE TOP, WHICH IS THE POSE THAT SEPARATES THE
// WRONG MODELS. A build that accepts any HIGHER card of the suit takes it, and
// the foundation reads six cards topped by a seven — a foundation that is no
// longer the Ace-to-King run `specs/foundations.md` describes, and whose sixth
// card is a seven rather than a six, so the failure names the model rather than
// only the count. Only the stated rule leaves the foundation at its five cards.
//
// One rank is skipped rather than several, because it is the smallest gap the
// rule refuses and therefore the hardest one for an off-by-one comparison to
// survive.

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

/** How high the foundation is built: the Ace through the five of spades. */
const BUILT_TO = 5;

/** The column the skipping card is offered from. */
const COLUMN = 0;

/** The offer: the foundation's own suit, two ranks above its top card. */
const OFFERED = card("7S");

/** One frame, so the still shows the board the refusal left. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("refuses a card of its own suit two ranks above its top card", async () => {
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
      `rank ${BUILT_TO + 1} of that suit and nothing else`,
  );
  assertLength(
    pileOf(after, "foundation", FOUNDATION),
    BUILT_TO,
    `the cards on foundation ${FOUNDATION} after the offer — ` +
      `${BUILT_TO + 1} is a build that accepts any higher card of the suit`,
  );
  assertDeepEqual(
    whereIs(after, offeredId),
    { pile: "tableau", index: COLUMN, row: 0 },
    `where the ${OFFERED.rank} (id ${offeredId}) sits after its refusal — ` +
      "specs/tableau.md: a refused move changes nothing",
  );
});
