// foundations/reject-off-suit — a foundation refuses the next rank up when it
// comes in another suit.
//
// `specs/foundations.md`: a foundation "builds one suit upward", its acceptance
// row reads "The card of rank `r + 1` and suit `s`", and "Once a foundation
// holds a card it is locked to that card's suit, and a card of any other suit is
// refused for as long as the foundation holds cards."
//
// ALL THREE WRONG SUITS ARE OFFERED, AT THE ONE RANK THE FOUNDATION WOULD TAKE,
// so the suit is the only thing left that can decide the move and every wrong
// model reads as a different board. A build that checks the rank alone takes all
// three and reads three cards added. A build that checks the rank and the
// COLOUR the way a tableau column does takes the two red sixes and refuses the
// club, reading two. A build that checks the rank and demands the SAME colour
// takes the club alone, reading one. Only the stated rule leaves the foundation
// at its five cards.
//
// Each six sits in a column of its own, so `whereIs` names where a card a build
// wrongly accepted actually went.

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

/**
 * The three off-suit cards, one per column, each at the rank the foundation
 * would take from its own suit.
 */
const OFFERS = [
  { column: 0, spec: card("6H") },
  { column: 1, spec: card("6D") },
  { column: 2, spec: card("6C") },
] as const;

/** One frame, so the still shows the board the three refusals left. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("refuses the next rank up in each of the other three suits", async () => {
  await openTable(h);
  await poseFoundation(h, FOUNDATION, SUIT, BUILT_TO);
  const ids: number[] = [];
  for (const offer of OFFERS) {
    const [id] = await poseColumn(h, offer.column, [offer.spec]);
    ids.push(id);
  }

  const verdicts: boolean[] = [];
  for (const offer of OFFERS) {
    verdicts.push(
      await h.debug.move("tableau", offer.column, 0, "foundation", FOUNDATION),
    );
  }

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "refused");
  const after = await h.snapshot();

  for (const [i, offer] of OFFERS.entries()) {
    assertEqual(
      verdicts[i],
      false,
      `move's verdict on the ${offer.spec.suit} ${offer.spec.rank} offered to ` +
        `a ${SUIT} foundation topped by the ${BUILT_TO} — ` +
        "specs/foundations.md locks a started foundation to its own suit",
    );
    assertDeepEqual(
      whereIs(after, ids[i]),
      { pile: "tableau", index: offer.column, row: 0 },
      `where the ${offer.spec.suit} ${offer.spec.rank} (id ${ids[i]}) sits ` +
        "after its refusal — specs/tableau.md: a refused move changes nothing",
    );
  }
  assertLength(
    pileOf(after, "foundation", FOUNDATION),
    BUILT_TO,
    `the cards on foundation ${FOUNDATION} after all three were offered — ` +
      `${BUILT_TO + 3} is a build that checks the rank alone, ${BUILT_TO + 2} ` +
      `one that checks the rank and an alternating colour, ${BUILT_TO + 1} one ` +
      "that checks the rank and the same colour",
  );
});
