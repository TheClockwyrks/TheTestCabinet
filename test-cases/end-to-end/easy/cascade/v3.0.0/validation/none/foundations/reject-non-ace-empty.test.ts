// foundations/reject-non-ace-empty — an empty foundation refuses everything
// that is not an Ace.
//
// `specs/foundations.md`, the acceptance table: a foundation holding "Nothing"
// accepts "An Ace, of any suit", and the file says the foundation "refuses
// every other card offered to it". This check decides that row in the refusing
// direction, which is the direction the accepting check cannot reach.
//
// TWO CARDS, AT THE TWO ENDS OF THE RANK ORDER, SO EVERY WRONG MODEL READS AS A
// DIFFERENT NUMBER. A build that starts a foundation with any card takes both,
// and the foundation reads two cards. A build that builds its foundations DOWN
// from the King takes the King alone, and the foundation reads one card holding
// a King. A build that mistakes "the lowest rank offered" for the Ace rule takes
// the `2` alone, and the foundation reads one card holding a `2`. Only the
// stated rule leaves the foundation empty, and the reading names which of the
// three a failing build implemented.
//
// The `2` and the King are black, the same colour as the Ace `ace-starts-empty`
// sends home, so nothing here can be passed or failed on a colour rule the
// specification does not state.
//
// EACH CARD SITS IN A COLUMN OF ITS OWN, so a refusal that quietly moved a card
// somewhere else is caught by `whereIs` naming where it went, rather than
// hidden by the other card standing in the same pile.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  whereIs,
  type Harness,
} from "../harness";

/** The empty foundation both cards are offered to. */
const FOUNDATION = 0;

/** The column holding the `2`, one rank above the Ace the rule admits. */
const TWO_COLUMN = 0;
const TWO = card("2S");

/** The column holding the King, the far end of the rank order. */
const KING_COLUMN = 1;
const KING = card("KS");

/** One frame, so the still shows the board the two refusals left. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("refuses a 2 and a King on an empty foundation, and leaves both where they were", async () => {
  await openTable(h);
  const [twoId] = await poseColumn(h, TWO_COLUMN, [TWO]);
  const [kingId] = await poseColumn(h, KING_COLUMN, [KING]);

  const twoAccepted = await h.debug.move(
    "tableau",
    TWO_COLUMN,
    0,
    "foundation",
    FOUNDATION,
  );
  const kingAccepted = await h.debug.move(
    "tableau",
    KING_COLUMN,
    0,
    "foundation",
    FOUNDATION,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "refused");
  const after = await h.snapshot();

  assertEqual(
    twoAccepted,
    false,
    `move's verdict on the ${TWO.suit} 2 offered to empty foundation ` +
      `${FOUNDATION} — specs/foundations.md: an empty foundation accepts an ` +
      "Ace and refuses every other card",
  );
  assertEqual(
    kingAccepted,
    false,
    `move's verdict on the ${KING.suit} King offered to empty foundation ` +
      `${FOUNDATION} — a foundation builds UP from the Ace, so a King is not ` +
      "how one is started",
  );
  assertLength(
    pileOf(after, "foundation", FOUNDATION),
    0,
    `the cards on foundation ${FOUNDATION} after both cards were offered to ` +
      "it — two is a build that starts a foundation with anything, one is a " +
      "build that took just one of them",
  );
  assertDeepEqual(
    whereIs(after, twoId),
    { pile: "tableau", index: TWO_COLUMN, row: 0 },
    `where the 2 (id ${twoId}) sits after its refusal — specs/tableau.md: a ` +
      "refused move changes nothing",
  );
  assertDeepEqual(
    whereIs(after, kingId),
    { pile: "tableau", index: KING_COLUMN, row: 0 },
    `where the King (id ${kingId}) sits after its refusal`,
  );
});
