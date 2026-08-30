// foundations/ace-starts-empty — an empty foundation accepts an Ace.
//
// `specs/foundations.md`, the acceptance table: a foundation holding "Nothing"
// accepts "An Ace, of any suit". This check decides that one row, in the
// accepting direction: the Ace is taken, and it is the foundation's card
// afterwards.
//
// AN EMPTY TABLE AND ONE CARD. `openTable` clears all thirteen piles, and the
// scenario puts back exactly the Ace the requirement is about. The other three
// foundations, the stock, the waste and the six other columns stay empty, so
// nothing but the rule under test can decide where the card ends up — and the
// reading is `whereIs`, which names the pile the Ace actually landed in rather
// than only counting the foundation. A build that accepted the move and filed
// the card somewhere else fails with that named.
//
// The four faculty gates are left at their reset defaults, which are all on.
// None of them can fire here: no column is left with a face-down card lowest,
// so `autoFlip` has nothing to turn, and one card home is not fifty-two, so
// `winDetect` has nothing to declare.

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

/** The empty foundation the Ace is offered to. */
const FOUNDATION = 0;

/** The column the Ace is offered from, and the only column holding anything. */
const COLUMN = 0;

/** The Ace under test. `specs/foundations.md` accepts an Ace "of any suit". */
const ACE = card("AS");

/**
 * One frame, so the still shows the board the move left.
 *
 * The harness runs the game off the wall clock, so nothing is drawn until a
 * frame is asked for. It decides nothing: Klondike moves only when it is moved,
 * and this frame changes no field the assertions read.
 */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("takes an Ace onto an empty foundation and leaves it standing there", async () => {
  await openTable(h);
  const [aceId] = await poseColumn(h, COLUMN, [ACE]);

  const accepted = await h.debug.move(
    "tableau",
    COLUMN,
    0,
    "foundation",
    FOUNDATION,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "accepted");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    true,
    `move to report the rules' verdict on the ${ACE.suit} Ace offered to ` +
      `empty foundation ${FOUNDATION} — specs/foundations.md: an empty ` +
      "foundation accepts an Ace of any suit",
  );
  assertDeepEqual(
    whereIs(after, aceId),
    { pile: "foundation", index: FOUNDATION, row: 0 },
    `where the Ace (id ${aceId}) sits after the move — it is the foundation's ` +
      "first and only card. A reading naming the tableau is a build that " +
      "refused it; a reading naming another foundation is one that filed it " +
      "in the wrong pile",
  );
  assertLength(
    pileOf(after, "foundation", FOUNDATION),
    1,
    `the cards on foundation ${FOUNDATION} after the Ace was accepted`,
  );
  assertLength(
    pileOf(after, "tableau", COLUMN),
    0,
    `the cards left in column ${COLUMN}, which held nothing but the Ace`,
  );
});
