// foundations/suit-locked-after-ace — the Ace that starts a foundation decides
// its suit for good.
//
// `specs/foundations.md`: "Once a foundation holds a card it is locked to that
// card's suit, and a card of any other suit is refused for as long as the
// foundation holds cards." The lock is a rule about a foundation's HISTORY
// rather than about a card, so deciding it takes both halves against the same
// foundation: the off-suit two is refused and the on-suit two is accepted, with
// nothing changed between them but which card is offered.
//
// THE TWO CARDS ARE THE SAME RANK AND THE SAME COLOUR, and that is the whole
// point of the pose. `2C` and `2S` are both black twos, so the only thing that
// can tell them apart is the suit itself: a build that locked a foundation to a
// COLOUR rather than to a suit takes both and the foundation reads three cards,
// while a build that locked nothing at all takes both as well but in the order
// they were offered, leaving a club under the spade. Only a build that locked
// the suit takes exactly one, and the card on top says which.
//
// THE FOUNDATION IS POSED AT THE ACE ALONE, which is the state the rule names.
// A taller build would decide the same thing but through a top card that had
// already been checked once, so the Ace is the honest place to read a lock that
// the Ace itself established.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { RANK_MIN } from "../constants";
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

/** The foundation under test, and the suit its Ace locks it to. */
const FOUNDATION = 0;
const SUIT = "spades" as const;

/** The column holding the off-suit two, which the lock has to refuse. */
const CLUBS_COLUMN = 0;
const CLUBS_TWO = card("2C");

/** The column holding the foundation's own two, which the lock has to admit. */
const SPADES_COLUMN = 1;
const SPADES_TWO = card("2S");

/** One frame, so the still shows the foundation holding its own suit alone. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("refuses another suit's two and accepts its own onto the Ace that started it", async () => {
  await openTable(h);
  await poseFoundation(h, FOUNDATION, SUIT, RANK_MIN);
  const [clubsId] = await poseColumn(h, CLUBS_COLUMN, [CLUBS_TWO]);
  const [spadesId] = await poseColumn(h, SPADES_COLUMN, [SPADES_TWO]);

  const clubsAccepted = await h.debug.move(
    "tableau",
    CLUBS_COLUMN,
    0,
    "foundation",
    FOUNDATION,
  );
  const spadesAccepted = await h.debug.move(
    "tableau",
    SPADES_COLUMN,
    0,
    "foundation",
    FOUNDATION,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "locked");
  const after = await h.snapshot();

  assertEqual(
    clubsAccepted,
    false,
    "move's verdict on the clubs 2 offered to a foundation started by the " +
      `${SUIT} Ace — specs/foundations.md locks a foundation to the suit of ` +
      "the card that started it, and a black two of another suit is still " +
      "another suit",
  );
  assertEqual(
    spadesAccepted,
    true,
    `move's verdict on the ${SUIT} 2 offered to the same foundation — it is ` +
      "the next card up in the suit the Ace locked it to",
  );
  assertLength(
    pileOf(after, "foundation", FOUNDATION),
    2,
    `the cards on foundation ${FOUNDATION} after both twos were offered — ` +
      "3 is a build that locked a colour rather than a suit, or locked nothing",
  );
  assertDeepEqual(
    whereIs(after, spadesId),
    { pile: "foundation", index: FOUNDATION, row: 1 },
    `where the ${SUIT} 2 (id ${spadesId}) sits after the move — it is the ` +
      "foundation's new top card, above the Ace",
  );
  assertDeepEqual(
    whereIs(after, clubsId),
    { pile: "tableau", index: CLUBS_COLUMN, row: 0 },
    `where the clubs 2 (id ${clubsId}) sits after its refusal — ` +
      "specs/tableau.md: a refused move changes nothing",
  );
});
