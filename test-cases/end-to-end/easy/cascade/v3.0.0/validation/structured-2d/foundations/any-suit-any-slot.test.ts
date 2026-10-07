// foundations/any-suit-any-slot — any suit may be started on any foundation.
//
// specs/foundations.md: "Any suit may be started on any empty foundation, so the
// suits are not tied to fixed slots." An empty foundation accepts an Ace of any
// suit.
// specs/instrumentation.md: `move` names its target with two scalars and returns
// whether the game's own rules accepted it.
//
// THE SLOT IS THE POINT. Every Ace is offered to the SAME foundation, the last one,
// and the table is cleared between the four rounds so that each Ace meets an empty
// foundation exactly as the first one did. A build that tied a suit to a slot —
// spades to the first foundation, hearts to the second, and so on, which is how a
// board is often drawn — accepts one of the four here and refuses three, and the
// failure names the suit it refused.
//
// The LAST foundation is chosen rather than the first because a build that ties
// suits to slots in the deck's own order would let the first slot take the first
// suit by accident; the last takes the first suit only where the slots are free.
//
// Each round also reads the other three foundations, so a build that answered `true`
// while dropping the Ace somewhere else fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  ACE,
  ALL_SUITS,
  captureStill,
  card,
  createHarness,
  FOUNDATIONS,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";
import { builtText, pileText } from "./board";

/** The foundation every Ace is offered to: the last of the four. */
const FOUNDATION = FOUNDATIONS[FOUNDATIONS.length - 1];
/** The column each Ace waits in. */
const COLUMN = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("starts the last foundation with each of the four Aces in turn", async () => {
  openTable(h);

  for (const suit of ALL_SUITS) {
    h.debug.clearTable();
    poseColumn(h, COLUMN, [card(suit, ACE)]);

    const accepted = h.debug.move(
      "tableau",
      COLUMN,
      0,
      "foundation",
      FOUNDATION,
    );
    const after = h.snapshot();

    assertEqual(
      accepted,
      true,
      `move of the Ace of ${suit} onto empty foundation ${FOUNDATION}: any ` +
        "suit may be started on any empty foundation (specs/foundations.md)",
    );
    assertDeepEqual(
      after.foundations.map((cards) => pileText(cards)),
      FOUNDATIONS.map((index) =>
        index === FOUNDATION ? builtText(suit, ACE) : [],
      ),
      `the four foundations after the Ace of ${suit} was accepted: ` +
        `foundation ${FOUNDATION} holds it and the other three are still ` +
        "empty (specs/foundations.md)",
    );
  }

  await h.advance(1);
  captureStill(h, "started");
});
