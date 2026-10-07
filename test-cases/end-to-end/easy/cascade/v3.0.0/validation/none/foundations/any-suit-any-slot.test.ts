// foundations/any-suit-any-slot — no suit belongs to any particular foundation.
//
// `specs/foundations.md`: "Any suit may be started on any empty foundation, so
// the suits are not tied to fixed slots." This check decides that sentence
// directly: each of the four Aces in turn is offered to the SAME foundation, the
// fourth, and every one of them has to be accepted.
//
// THE FOURTH SLOT RATHER THAN THE FIRST, because a build that ties suits to
// slots almost always ties them in the deck's own order — spades, hearts,
// diamonds, clubs (`specs/deal.md`) — so the first slot would take the spade Ace
// by accident under that wrong model and only the later Aces would catch it. On
// the fourth slot the wrong model takes at most one of the four, and which one
// it takes says which order it assumed.
//
// EACH ACE IS TRIED ON AN OTHERWISE EMPTY BOARD. The foundation and the column
// are emptied with `clearPile` between the four offers, so each is decided by
// the rule alone rather than by whatever the previous offer left standing, and
// no run of foundation cards ever builds up to complicate the reading. The other
// three foundations are never touched, so a build that filed an Ace in the first
// empty slot it found instead of the one it was given is caught by `whereIs`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { RANK_MIN, SUITS } from "../constants";
import {
  captureStill,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  whereIs,
  type Harness,
} from "../harness";

/** The foundation every Ace is offered to: the fourth of the four. */
const FOUNDATION = 3;

/** The column each Ace is offered from. */
const COLUMN = 0;

/** One frame, so the still shows the fourth slot started by the last Ace. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("starts the fourth foundation with each of the four Aces in turn", async () => {
  await openTable(h);

  for (const suit of SUITS) {
    await h.debug.clearPile("foundation", FOUNDATION);
    await h.debug.clearPile("tableau", COLUMN);
    const [aceId] = await poseColumn(h, COLUMN, [
      { suit, rank: RANK_MIN, faceUp: true },
    ]);

    const accepted = await h.debug.move(
      "tableau",
      COLUMN,
      0,
      "foundation",
      FOUNDATION,
    );

    await h.advance(DRAW_FRAMES);
    await captureStill(h, "started");
    const after = await h.snapshot();

    assertEqual(
      accepted,
      true,
      `move's verdict on the ${suit} Ace offered to empty foundation ` +
        `${FOUNDATION} — specs/foundations.md: any suit may be started on any ` +
        "empty foundation",
    );
    assertDeepEqual(
      whereIs(after, aceId),
      { pile: "foundation", index: FOUNDATION, row: 0 },
      `where the ${suit} Ace (id ${aceId}) sits after the move — a reading ` +
        "naming the tableau is a build that tied this slot to another suit; " +
        "one naming another foundation is a build that chose the slot itself",
    );
    assertLength(
      pileOf(after, "foundation", FOUNDATION),
      1,
      `the cards on foundation ${FOUNDATION} after the ${suit} Ace was offered`,
    );
  }
});
