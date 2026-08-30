// foundations/king-completes — the King is the last card a foundation takes.
//
// `specs/foundations.md`: a foundation "builds one suit upward from Ace to
// King", and "A foundation is complete when it holds thirteen cards, its Ace
// through its King." The King is the top of the rank order the file fixes
// (`specs/deal.md` puts the Ace low and the King high), so this check decides
// that the ordinary acceptance rule still holds at the very top of the run and
// that a completed foundation is thirteen cards deep.
//
// THE FOUNDATION IS POSED ONE CARD SHORT, AT THE QUEEN, so the King is offered
// as the next card up and nothing else about the pose can decide the move. The
// other three foundations stay empty, which keeps this away from the win: a
// board is won when every foundation holds its thirteen (`specs/victory.md`),
// not when one does, so `winDetect` is left at its reset default and has nothing
// to declare.
//
// THE READING IS THE HEIGHT AND THE CARD ON TOP. Thirteen with the King last is
// the pass. Twelve is a build that refused the King, whether because it capped
// the run below the King or because its rank comparison stops short. Thirteen
// with something else last is a build that appended somewhere other than the
// top.

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
  topOf,
  whereIs,
  type Harness,
} from "../harness";

/** The foundation under test, and the suit it is locked to. */
const FOUNDATION = 0;
const SUIT = "spades" as const;

/** How high the foundation is built before the King: the Ace through the Queen. */
const BUILT_TO = RANK_MAX - 1;

/** The column the King is offered from. */
const COLUMN = 0;

/** The offer: the King of the foundation's own suit. */
const OFFERED = card("KS");

/** One frame, so the still shows the completed foundation. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("accepts the King onto the Queen and stands thirteen cards deep", async () => {
  await openTable(h);
  await poseFoundation(h, FOUNDATION, SUIT, BUILT_TO);
  const [kingId] = await poseColumn(h, COLUMN, [OFFERED]);

  const accepted = await h.debug.move(
    "tableau",
    COLUMN,
    0,
    "foundation",
    FOUNDATION,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "completed");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    true,
    `move's verdict on the ${SUIT} King offered to a ${SUIT} foundation ` +
      "topped by its Queen — specs/foundations.md builds a foundation upward " +
      "to the King",
  );
  assertLength(
    pileOf(after, "foundation", FOUNDATION),
    RANK_MAX,
    `the cards on foundation ${FOUNDATION} after the King — ` +
      "specs/foundations.md: a foundation is complete when it holds thirteen " +
      "cards, its Ace through its King",
  );
  assertDeepEqual(
    whereIs(after, kingId),
    { pile: "foundation", index: FOUNDATION, row: RANK_MAX - 1 },
    `where the King (id ${kingId}) sits after the move — it is the ` +
      "foundation's last and topmost card",
  );
  assertEqual(
    topOf(pileOf(after, "foundation", FOUNDATION))?.rank,
    RANK_MAX,
    `the rank of foundation ${FOUNDATION}'s top card once it is complete`,
  );
});
