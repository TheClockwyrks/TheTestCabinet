// foundations/reject-onto-king — a completed foundation takes nothing more.
//
// `specs/foundations.md`, the acceptance table's last row: a foundation holding
// "Its King" accepts "Nothing". This check decides that row, which is the one
// row of the table the ordinary `r + 1` rule cannot express — there is no rank
// above the King (`specs/deal.md` puts the King high) — so a build that leaves
// the row out is a build whose foundation either overflows or wraps.
//
// THREE ACES ARE OFFERED, AND THE THIRD IS THE ONE THAT MATTERS. A build that
// wraps the rank order round from the King back to the Ace takes the Ace of its
// OWN suit, so the spade Ace is offered to catch exactly that. The two red Aces
// catch the other model, a build that lets a complete foundation accept anything
// at all, and they are what makes this the item's "a card of any suit". Only a
// build that answers the last row of the table leaves the foundation at thirteen
// cards, and the count says which of the two wrong models it implemented: three
// added for the anything model, one for the wrap.
//
// THE SPADE ACE IS A SECOND COPY OF THE ONE AT THE BOTTOM OF THE FOUNDATION, and
// it has to be. The wrap model is a rule about the foundation's own suit, so the
// only card that probes it is that suit's Ace, and a completed foundation holds
// every card of its suit already. The debug surface poses cards one at a time
// and the acceptance rule is stated over the offered card and the foundation's
// top card alone, with no clause about the rest of the deck, so a build that
// answers by the stated rule refuses this offer like the other two.
//
// The three other foundations stay empty, so thirteen cards home is not the win
// (`specs/victory.md` wants all fifty-two) and `winDetect` stays out of it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { RANK_MAX } from "../constants";
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

/** The completed foundation under test, and the suit it holds. */
const FOUNDATION = 0;
const SUIT = "spades" as const;

/**
 * The three Aces offered to it, each in a column of its own.
 *
 * The spade Ace probes a build that wraps from the King back to the Ace of the
 * same suit; the two red ones probe a build that stops checking once a
 * foundation is complete.
 */
const OFFERS = [
  { column: 0, spec: card("AH") },
  { column: 1, spec: card("AD") },
  { column: 2, spec: card("AS") },
] as const;

/** One frame, so the still shows the completed foundation refusing all three. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("refuses every Ace offered to a foundation that already holds its King", async () => {
  await openTable(h);
  await poseFoundation(h, FOUNDATION, SUIT, RANK_MAX);
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
      `move's verdict on the ${offer.spec.suit} Ace offered to a complete ` +
        `${SUIT} foundation — specs/foundations.md: a foundation holding its ` +
        "King accepts nothing",
    );
    assertDeepEqual(
      whereIs(after, ids[i]),
      { pile: "tableau", index: offer.column, row: 0 },
      `where the ${offer.spec.suit} Ace (id ${ids[i]}) sits after its ` +
        "refusal — specs/tableau.md: a refused move changes nothing",
    );
  }
  assertLength(
    pileOf(after, "foundation", FOUNDATION),
    RANK_MAX,
    `the cards on foundation ${FOUNDATION} after all three Aces were offered ` +
      `to it — ${RANK_MAX + 3} is a build that stops checking once a ` +
      `foundation is complete, ${RANK_MAX + 1} one that wraps the rank order ` +
      "from the King back to the Ace",
  );
});
