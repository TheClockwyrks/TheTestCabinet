// runs/leaves-cards-above — the cards lying ABOVE the one a move names stay in
// the source column, in their order and with their faces unchanged.
//
// `specs/tableau.md`, "What a move takes": "The cards above the one taken stay in
// the column, in their order and with their faces unchanged."
//
// THE OTHER HALF OF THE TAKE RULE. `runs/takes-every-card-below` reads what
// travelled; this reads what was left, so a build that empties the whole column on
// every move and a build that takes too few cards grade differently. The move
// names the third card of a six-card column, so two cards stay, and each wrong
// model reads as a different remainder: a build that took the whole column leaves
// none, and a build off by one leaves one or three.
//
// THE TWO CARDS LEFT ARE FACE-UP, so `autoFlip` has nothing to turn and the faces
// this check reads are the faces the move left rather than the flip rule's doing.
// The turning of a newly exposed card is `tableau/flips-exposed`, and the gate is
// left at its reset default, on, because nothing here asks it to act.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  card,
  cards,
  createHarness,
  facesOf,
  openTable,
  pileOf,
  poseColumn,
  type Harness,
} from "../harness";

/** The column the move is made from. Not column `0`, so a hard-coded one fails. */
const SOURCE = 3;

/** The column the taken cards are offered to. */
const TARGET = 6;

/**
 * The source column, first card first: six face-up cards in descending,
 * alternating order, so every slice of it is a run and nothing but the take rule
 * decides which cards stay.
 */
const COLUMN = cards("KH", "QS", "JH", "10S", "9H", "8S");

/**
 * The row the move names, counted from the column's first card, as
 * `specs/instrumentation.md` counts `fromRow`.
 *
 * The third card, so exactly two lie above it.
 */
const GRABBED_ROW = 2;

/**
 * The card waiting on the target: a black queen, which accepts the red jack that
 * leads the taken run.
 */
const TARGET_CARD = card("QC");

/** One frame, so the still shows the board the move left. It decides nothing. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("leaves the two cards above the named one in the column, in order and face-up", async () => {
  await openTable(h);
  await poseColumn(h, TARGET, [TARGET_CARD]);
  const columnIds = await poseColumn(h, SOURCE, COLUMN);
  const stayingIds = columnIds.slice(0, GRABBED_ROW);

  const accepted = await h.debug.move(
    "tableau",
    SOURCE,
    GRABBED_ROW,
    "tableau",
    TARGET,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "source");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    true,
    `move to report the rules' verdict on the run taken from row ${GRABBED_ROW} ` +
      `of column ${SOURCE} — its leading card is the red jack, and column ` +
      `${TARGET} holds a black queen. A refusal leaves nothing to say about what ` +
      "the move left behind (specs/tableau.md)",
  );

  const left = pileOf(after, "tableau", SOURCE);
  assertDeepEqual(
    left.map((c) => c.id),
    stayingIds,
    `column ${SOURCE} read bottom card first after the move: the two cards that ` +
      "lay above the named one, in the order they lay in. A longer list is a " +
      "build that took too few cards, a shorter one is a build that took cards " +
      "from above the row it was given",
  );
  assertDeepEqual(
    facesOf(left),
    stayingIds.map(() => true),
    `the faces of the cards left in column ${SOURCE} — they were face-up before ` +
      "the move and the specification leaves them as they were",
  );
});
