// tableau/accepts-from-waste — the waste is a source a column takes from.
//
// THE RULE. `specs/tableau.md`: "A column accepts a run from another column,
// from the waste, and from a foundation, on exactly the terms above." This check
// decides the waste half of that sentence. The terms are already graded by
// `tableau/build-down-alternating` and the four refusals; what is decided here
// is that the SOURCE being the waste takes nothing away from them, which is a
// real build shape to get wrong — a rules check written over two columns, with
// the waste reaching it by a different path.
//
// THE WASTE HOLDS MORE THAN THE CARD THAT MOVES. Two cards, in two sets: the two
// of diamonds turned first and squared away, the seven of spades turned after it
// and showing. `specs/stock.md` makes the shown set's top card the one that may
// be played, so the seven is the waste's playable card and the two is not. A
// build that plays off the wrong end of the waste sends the two, which the
// column refuses, and both the verdict and `whereIs` name it.
//
// The column shows the eight of hearts, one rank above the seven and the other
// color, so `specs/tableau.md` accepts the run of one the waste offers.
//
// WHAT THE SET MEMORY DOES AFTERWARDS is `stock/set-shrinks-on-play`, and this
// point deliberately reads none of it: what it reads is that the seven left the
// waste and landed on the column, and that the buried two is still on the waste.
//
// The four faculty gates are left at their reset defaults, which are all on.
// The source is the waste rather than a column, so `autoFlip` has nothing to
// turn, and no card goes home, so `winDetect` has nothing to declare.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  card,
  cards,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  poseWaste,
  whereIs,
  type Harness,
} from "../harness";

/** The column the waste's card is offered to, and the card it shows. */
const TARGET = 0;
const TARGET_CARD = card("8H");

/** The waste, bottom card first: one card buried, one card showing. */
const WASTE = cards("2D", "7S");
/** One card on each turned set, oldest first, so the seven is the one shown. */
const WASTE_SETS = [1, 1];

/** Where the waste's top card sits in the pile, counted from the bottom. */
const WASTE_TOP_ROW = WASTE.length - 1;

/** One frame, so the still shows the waste's card on the column. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("takes the waste's top card onto a legal column and leaves the buried card behind", async () => {
  await openTable(h);
  const [targetId] = await poseColumn(h, TARGET, [TARGET_CARD]);
  const [buriedId, playedId] = await poseWaste(h, WASTE, WASTE_SETS);

  const accepted = await h.debug.move(
    "waste",
    0,
    WASTE_TOP_ROW,
    "tableau",
    TARGET,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "accepted");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    true,
    "move's verdict on the waste's top card, the spades 7, offered to a " +
      `column showing the ${TARGET_CARD.suit} 8 — specs/tableau.md: a column ` +
      "accepts a run from the waste on the same terms as one from a column",
  );
  assertDeepEqual(
    whereIs(after, playedId),
    { pile: "tableau", index: TARGET, row: 1 },
    `where the spades 7 (id ${playedId}) sits after the move — it is the ` +
      "column's new lowest card. A reading naming the waste is a build that " +
      "refused it",
  );
  assertDeepEqual(
    whereIs(after, buriedId),
    { pile: "waste", index: 0, row: 0 },
    `where the diamonds 2 (id ${buriedId}) sits after the move — it was ` +
      "buried under the shown set and no move named it",
  );
  assertLength(
    pileOf(after, "waste"),
    WASTE.length - 1,
    "the cards left on the waste after the move",
  );
  assertDeepEqual(
    whereIs(after, targetId),
    { pile: "tableau", index: TARGET, row: 0 },
    `where the ${TARGET_CARD.suit} 8 (id ${targetId}) sits after the move`,
  );
});
