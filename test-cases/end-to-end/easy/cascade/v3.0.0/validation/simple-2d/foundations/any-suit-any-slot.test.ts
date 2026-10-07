// foundations/any-suit-any-slot — any suit may be started on any foundation.
//
// specs/foundations.md: "Any suit may be started on any empty foundation, so the
// suits are not tied to fixed slots." An empty foundation accepts an Ace of any
// suit.
// specs/instrumentation.md: `move` names its target with two scalars and returns
// whether the game's own rules accepted it.
//
// THE SLOT IS THE POINT. Every Ace is offered to the SAME foundation, the fourth,
// and the table is cleared between the four rounds so that each Ace meets an empty
// foundation exactly as the first one did. A build that tied a suit to a slot —
// spades to the first foundation, hearts to the second, and so on, which is how a
// board is often drawn — accepts one of the four here and refuses three, and the
// failure names the suit it refused.
//
// The fourth foundation is chosen rather than the first because a build that ties
// suits to slots in the deck's own order would let the FIRST slot take the first
// suit by accident; the fourth takes the first suit only where the slots are free.
//
// Each round also reads the other three foundations, so a build that answered `true`
// while dropping the Ace somewhere else fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileSpecs,
  poseColumn,
  type Harness,
} from "../harness";

/** The foundation every Ace is offered to: the fourth of the four. */
const FOUNDATION = 3;
/** The column each Ace waits in. */
const COLUMN = 0;
/** The four Aces, in the order they are offered. */
const ACES = ["AS", "AH", "AD", "AC"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("starts the fourth foundation with each of the four Aces in turn", async () => {
  openTable(h);

  for (const ace of ACES) {
    h.debug.clearTable();
    poseColumn(h, COLUMN, [ace]);

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
      `move of ${ace} onto empty foundation ${FOUNDATION}: any suit may be ` +
        "started on any empty foundation (specs/foundations.md)",
    );
    assertDeepEqual(
      after.foundations.map((cards) => pileSpecs(cards)),
      [[], [], [], [ace]],
      `the four foundations after ${ace} was accepted: the fourth holds it ` +
        "and the other three are still empty (specs/foundations.md)",
    );
  }

  await h.advance(1);
  captureStill(h, "started");
});
