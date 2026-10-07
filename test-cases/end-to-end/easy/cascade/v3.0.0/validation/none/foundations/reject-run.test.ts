// foundations/reject-run — a foundation takes one card, never a run.
//
// `specs/foundations.md`: "A foundation takes exactly one card at a time. A run
// of two or more cards is refused, even when its leading card alone would be
// accepted."
//
// THE POSE IS THE SENTENCE'S OWN EDGE CASE. The column holds the six of spades
// with the five of hearts fanned below it, which `specs/tableau.md` makes an
// ordered run: each card one rank lower than, and the opposite colour of, the
// card above it. The grab names the six, and `specs/instrumentation.md` moves
// "the grabbed card and every card the pile holds after it" together, so what
// reaches the foundation is a run of two led by a card the foundation would take
// on its own — the five of spades is on top of it.
//
// EVERY WRONG MODEL LEAVES A DIFFERENT BOARD, and the check reads both piles so
// the failure names which. A build that lands the whole run reads seven cards on
// the foundation and an empty column, and its foundation is no longer an
// ascending single-suit run at all. A build that takes the leading card and
// drops the rest reads six on the foundation and one card left in the column. A
// build that takes the leading card and RETURNS the rest reads six and two,
// which the foundation's height alone would not separate from the pass. Only the
// stated rule leaves five and two.
//
// The single-card acceptance this rule is the exception to is decided by
// `build-up-same-suit`, which poses the same foundation and offers the same six
// alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  cards,
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

/** The column the run is offered from. */
const COLUMN = 0;

/**
 * The run offered, in pile order: the six of spades with the five of hearts
 * below it.
 *
 * An ordered run by `specs/tableau.md`, and one whose leading six the foundation
 * would take on its own, which is exactly the case `specs/foundations.md` calls
 * out.
 */
const RUN = cards("6S", "5H");

/** Where the run's leading card sits in the column, counted from the bottom. */
const LEAD_ROW = 0;

/** One frame, so the still shows the foundation refusing the run. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("refuses a two-card run whose leading card alone would be accepted", async () => {
  await openTable(h);
  await poseFoundation(h, FOUNDATION, SUIT, BUILT_TO);
  const [leadId, trailId] = await poseColumn(h, COLUMN, RUN);

  const accepted = await h.debug.move(
    "tableau",
    COLUMN,
    LEAD_ROW,
    "foundation",
    FOUNDATION,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "refused");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    false,
    `move's verdict on a two-card run led by the ${SUIT} ${RUN[0].rank} ` +
      `offered to a ${SUIT} foundation topped by the ${BUILT_TO} — ` +
      "specs/foundations.md: a foundation takes exactly one card at a time",
  );
  assertLength(
    pileOf(after, "foundation", FOUNDATION),
    BUILT_TO,
    `the cards on foundation ${FOUNDATION} after the run was offered — ` +
      `${BUILT_TO + 2} is a build that landed the whole run, ` +
      `${BUILT_TO + 1} one that took the leading card and left the rest`,
  );
  assertLength(
    pileOf(after, "tableau", COLUMN),
    RUN.length,
    `the cards left in column ${COLUMN} after the refusal — ` +
      "specs/tableau.md: every card a refused move carried returns to the " +
      "pile it was taken from, in the order it left",
  );
  assertDeepEqual(
    whereIs(after, leadId),
    { pile: "tableau", index: COLUMN, row: 0 },
    `where the run's leading ${RUN[0].rank} (id ${leadId}) sits after the ` +
      "refusal",
  );
  assertDeepEqual(
    whereIs(after, trailId),
    { pile: "tableau", index: COLUMN, row: 1 },
    `where the ${RUN[1].rank} beneath it (id ${trailId}) sits after the ` +
      "refusal — it is still the column's lowest card, in the order it left",
  );
});
